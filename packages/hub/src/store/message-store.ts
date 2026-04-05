/**
 * MessageStore — SQLite-backed persistent message storage with FTS5 full-text search.
 * Falls back to JSONL append file if better-sqlite3 is unavailable.
 *
 * DB path: ~/.jackclaw/hub/messages.db
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import initSqlJs from 'sql.js'

const HUB_DIR = path.join(os.homedir(), '.jackclaw', 'hub')
export const DB_PATH = path.join(HUB_DIR, 'messages.db')
const FALLBACK_JSONL = path.join(HUB_DIR, 'messages.jsonl')

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface StoredMessage {
  id: string
  threadId?: string
  fromAgent: string
  toAgent: string
  fromHuman?: string
  content: string
  type: string
  replyTo?: string
  attachments?: unknown
  status: string
  ts: number
  encrypted: boolean
}

export interface SearchOptions {
  from?: string
  to?: string
  after?: number
  before?: number
  limit?: number
  offset?: number
}

// ─── Row mapping ──────────────────────────────────────────────────────────────

function row2msg(row: Record<string, unknown>): StoredMessage {
  return {
    id:          row.id as string,
    threadId:    (row.thread_id as string | null) ?? undefined,
    fromAgent:   row.from_agent as string,
    toAgent:     row.to_agent as string,
    fromHuman:   (row.from_human as string | null) ?? undefined,
    content:     row.content as string,
    type:        row.type as string,
    replyTo:     (row.reply_to as string | null) ?? undefined,
    attachments: (row.attachments as string | null)
      ? JSON.parse(row.attachments as string)
      : undefined,
    status:    row.status as string,
    ts:        row.ts as number,
    encrypted: (row.encrypted as number) === 1,
  }
}

function sanitizeFts(q: string): string {
  return `"${q.replace(/"/g, '""')}"`
}

// ─── SQLite backend ───────────────────────────────────────────────────────────

const CREATE_STMTS = [
  `CREATE TABLE IF NOT EXISTS messages (
    id          TEXT PRIMARY KEY,
    thread_id   TEXT,
    from_agent  TEXT,
    to_agent    TEXT,
    from_human  TEXT,
    content     TEXT,
    type        TEXT,
    reply_to    TEXT,
    attachments TEXT,
    status      TEXT DEFAULT 'sent',
    ts          INTEGER,
    encrypted   INTEGER DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_thread ON messages(thread_id)`,
  `CREATE INDEX IF NOT EXISTS idx_to     ON messages(to_agent)`,
  `CREATE INDEX IF NOT EXISTS idx_ts     ON messages(ts)`,
  `CREATE TABLE IF NOT EXISTS threads (
    id               TEXT PRIMARY KEY,
    participants     TEXT,
    title            TEXT,
    last_message_at  INTEGER,
    message_count    INTEGER DEFAULT 0
  )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    message_id UNINDEXED,
    content,
    from_agent,
    to_agent
  )`,
]

/**
 * sql.js helper: run a query and return rows as Record<string, unknown>[]
 */
function sqlAll(db: InstanceType<import('sql.js').SqlJsStatic['Database']>, sql: string, params: unknown[] = []): Record<string, unknown>[] {
  const stmt = db.prepare(sql)
  if (params.length) stmt.bind(params as (string | number | null | Uint8Array)[])
  const results: Record<string, unknown>[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject()
    results.push(row as Record<string, unknown>)
  }
  stmt.free()
  return results
}

function sqlGet(db: InstanceType<import('sql.js').SqlJsStatic['Database']>, sql: string, params: unknown[] = []): Record<string, unknown> | undefined {
  const rows = sqlAll(db, sql, params)
  return rows[0]
}

function sqlRun(db: InstanceType<import('sql.js').SqlJsStatic['Database']>, sql: string, params: unknown[] = []): void {
  db.run(sql, params as (string | number | null | Uint8Array)[])
}

class SqliteMessageStore {
  private db!: InstanceType<import('sql.js').SqlJsStatic['Database']>
  private dbPath: string
  private _saveTimer: NodeJS.Timeout | null = null
  private _dirty = false

  constructor(dbPath: string, dbInstance: InstanceType<import('sql.js').SqlJsStatic['Database']>) {
    this.dbPath = dbPath
    this.db = dbInstance
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    for (const sql of CREATE_STMTS) {
      this.db.run(sql)
    }
    // Auto-save to disk every 5s if dirty
    this._saveTimer = setInterval(() => this._flush(), 5000)
    this._saveTimer.unref()
  }

  private _markDirty(): void {
    this._dirty = true
  }

  private _flush(): void {
    if (!this._dirty) return
    try {
      const data = this.db.export()
      const buf = Buffer.from(data)
      const tmpFile = this.dbPath + '.tmp'
      fs.writeFileSync(tmpFile, buf)
      fs.renameSync(tmpFile, this.dbPath)
      this._dirty = false
    } catch (e) {
      console.error('[message-store] flush to disk failed:', e)
    }
  }

  saveMessage(msg: StoredMessage): void {
    sqlRun(this.db, `
      INSERT OR REPLACE INTO messages
        (id, thread_id, from_agent, to_agent, from_human, content, type,
         reply_to, attachments, status, ts, encrypted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      msg.id,
      msg.threadId ?? null,
      msg.fromAgent,
      msg.toAgent,
      msg.fromHuman ?? null,
      msg.content,
      msg.type,
      msg.replyTo ?? null,
      msg.attachments != null ? JSON.stringify(msg.attachments) : null,
      msg.status ?? 'sent',
      msg.ts,
      msg.encrypted ? 1 : 0,
    ])
    // Keep FTS in sync
    sqlRun(this.db, `DELETE FROM messages_fts WHERE message_id = ?`, [msg.id])
    sqlRun(this.db, `
      INSERT INTO messages_fts (message_id, content, from_agent, to_agent)
      VALUES (?, ?, ?, ?)
    `, [msg.id, msg.content, msg.fromAgent, msg.toAgent])

    if (msg.threadId) {
      sqlRun(this.db, `
        INSERT INTO threads (id, participants, last_message_at, message_count)
        VALUES (?, '[]', ?, 1)
        ON CONFLICT(id) DO UPDATE SET
          last_message_at = excluded.last_message_at,
          message_count   = message_count + 1
      `, [msg.threadId, msg.ts])
    }
    this._markDirty()
  }

  getMessage(id: string): StoredMessage | null {
    const row = sqlGet(this.db, `SELECT * FROM messages WHERE id = ?`, [id])
    return row ? row2msg(row) : null
  }

  getThread(threadId: string, limit = 50, offset = 0): StoredMessage[] {
    return sqlAll(this.db,
      `SELECT * FROM messages WHERE thread_id = ? ORDER BY ts ASC LIMIT ? OFFSET ?`,
      [threadId, limit, offset],
    ).map(row2msg)
  }

  getMessagesByParticipant(agentHandle: string, limit = 50, offset = 0): StoredMessage[] {
    return sqlAll(this.db, `
      SELECT * FROM messages
      WHERE from_agent = ? OR to_agent = ?
      ORDER BY ts DESC LIMIT ? OFFSET ?
    `, [agentHandle, agentHandle, limit, offset]).map(row2msg)
  }

  searchMessages(query: string, opts: SearchOptions = {}): StoredMessage[] {
    const { from, to, after, before, limit = 20, offset = 0 } = opts

    let sql = `
      SELECT m.* FROM messages m
      WHERE m.id IN (
        SELECT message_id FROM messages_fts WHERE messages_fts MATCH ?
      )
    `
    const params: unknown[] = [sanitizeFts(query)]

    if (from)   { sql += ` AND m.from_agent = ?`; params.push(from) }
    if (to)     { sql += ` AND m.to_agent = ?`;   params.push(to) }
    if (after)  { sql += ` AND m.ts > ?`;          params.push(after) }
    if (before) { sql += ` AND m.ts < ?`;          params.push(before) }

    sql += ` ORDER BY m.ts DESC LIMIT ? OFFSET ?`
    params.push(limit, offset)

    try {
      return sqlAll(this.db, sql, params).map(row2msg)
    } catch {
      // FTS query failed — fall back to LIKE
      const likeSql = `
        SELECT * FROM messages
        WHERE content LIKE ?
        ${from ? ' AND from_agent = ?' : ''}
        ${to ? ' AND to_agent = ?' : ''}
        ${after ? ' AND ts > ?' : ''}
        ${before ? ' AND ts < ?' : ''}
        ORDER BY ts DESC LIMIT ? OFFSET ?
      `
      const likeParams: unknown[] = [`%${query}%`]
      if (from) likeParams.push(from)
      if (to) likeParams.push(to)
      if (after) likeParams.push(after)
      if (before) likeParams.push(before)
      likeParams.push(limit, offset)
      return sqlAll(this.db, likeSql, likeParams).map(row2msg)
    }
  }

  getInbox(agentHandle: string, limit = 20, offset = 0): StoredMessage[] {
    return sqlAll(this.db,
      `SELECT * FROM messages WHERE to_agent = ? ORDER BY ts DESC LIMIT ? OFFSET ?`,
      [agentHandle, limit, offset],
    ).map(row2msg)
  }

  deleteMessage(id: string): void {
    sqlRun(this.db, `DELETE FROM messages_fts WHERE message_id = ?`, [id])
    sqlRun(this.db, `DELETE FROM messages WHERE id = ?`, [id])
    this._markDirty()
  }

  getStats(): { totalMessages: number; totalThreads: number } {
    const msgsRow    = sqlGet(this.db, `SELECT COUNT(*) as n FROM messages`)
    const threadsRow = sqlGet(this.db, `SELECT COUNT(*) as n FROM threads`)
    return {
      totalMessages: (msgsRow?.n as number) ?? 0,
      totalThreads:  (threadsRow?.n as number) ?? 0,
    }
  }
}

// ─── JSONL fallback backend ───────────────────────────────────────────────────

class JsonlMessageStore {
  private file: string
  private messages: StoredMessage[] = []

  constructor(file: string) {
    this.file = file
    fs.mkdirSync(path.dirname(file), { recursive: true })
    this._load()
  }

  private _load(): void {
    if (!fs.existsSync(this.file)) return
    try {
      const lines = fs.readFileSync(this.file, 'utf-8').trim().split('\n').filter(Boolean)
      this.messages = lines.map(l => JSON.parse(l) as StoredMessage)
    } catch { /* start empty */ }
  }

  private _rewrite(): void {
    fs.writeFileSync(this.file, this.messages.map(m => JSON.stringify(m)).join('\n') + '\n')
  }

  saveMessage(msg: StoredMessage): void {
    const idx = this.messages.findIndex(m => m.id === msg.id)
    if (idx >= 0) {
      this.messages[idx] = msg
      this._rewrite()
    } else {
      this.messages.push(msg)
      fs.appendFileSync(this.file, JSON.stringify(msg) + '\n')
    }
  }

  getMessage(id: string): StoredMessage | null {
    return this.messages.find(m => m.id === id) ?? null
  }

  getThread(threadId: string, limit = 50, offset = 0): StoredMessage[] {
    return this.messages
      .filter(m => m.threadId === threadId)
      .sort((a, b) => a.ts - b.ts)
      .slice(offset, offset + limit)
  }

  getMessagesByParticipant(agentHandle: string, limit = 50, offset = 0): StoredMessage[] {
    return this.messages
      .filter(m => m.fromAgent === agentHandle || m.toAgent === agentHandle)
      .sort((a, b) => b.ts - a.ts)
      .slice(offset, offset + limit)
  }

  searchMessages(query: string, opts: SearchOptions = {}): StoredMessage[] {
    const { from, to, after, before, limit = 20, offset = 0 } = opts
    const q = query.toLowerCase()
    return this.messages
      .filter(m =>
        m.content.toLowerCase().includes(q) &&
        (!from   || m.fromAgent === from) &&
        (!to     || m.toAgent   === to) &&
        (!after  || m.ts > after) &&
        (!before || m.ts < before),
      )
      .sort((a, b) => b.ts - a.ts)
      .slice(offset, offset + limit)
  }

  getInbox(agentHandle: string, limit = 20, offset = 0): StoredMessage[] {
    return this.messages
      .filter(m => m.toAgent === agentHandle)
      .sort((a, b) => b.ts - a.ts)
      .slice(offset, offset + limit)
  }

  deleteMessage(id: string): void {
    this.messages = this.messages.filter(m => m.id !== id)
    this._rewrite()
  }

  getStats(): { totalMessages: number; totalThreads: number } {
    const threads = new Set(this.messages.filter(m => m.threadId).map(m => m.threadId!))
    return { totalMessages: this.messages.length, totalThreads: threads.size }
  }
}

// ─── MessageStore facade ──────────────────────────────────────────────────────

type Backend = SqliteMessageStore | JsonlMessageStore

export class MessageStore {
  private backend: Backend

  private constructor(backend: Backend) {
    this.backend = backend
  }

  /**
   * Create a MessageStore.
   * Respects HUB_STORE env var: 'jsonl' forces JSONL; anything else (default: 'sqlite') tries sql.js.
   */
  static async create(dbPath = DB_PATH): Promise<MessageStore> {
    const storeEnv = (process.env.HUB_STORE ?? 'sqlite').toLowerCase()

    if (storeEnv === 'jsonl') {
      console.log(`[message-store] HUB_STORE=jsonl → JSONL backend: ${FALLBACK_JSONL}`)
      return new MessageStore(new JsonlMessageStore(FALLBACK_JSONL))
    }

    try {
      const SQL = await initSqlJs()
      let dbInstance: InstanceType<typeof SQL.Database>
      // Load existing DB from disk if present
      if (fs.existsSync(dbPath)) {
        const fileData = fs.readFileSync(dbPath)
        dbInstance = new SQL.Database(fileData)
      } else {
        dbInstance = new SQL.Database()
      }
      const backend = new SqliteMessageStore(dbPath, dbInstance)
      console.log(`[message-store] HUB_STORE=sqlite → sql.js backend: ${dbPath}`)
      return new MessageStore(backend)
    } catch (err) {
      console.warn(
        `[message-store] sql.js unavailable (${(err as Error).message}), ` +
        `using JSONL fallback: ${FALLBACK_JSONL}`,
      )
      return new MessageStore(new JsonlMessageStore(FALLBACK_JSONL))
    }
  }

  /** Synchronous fallback constructor for backward compat. Uses JSONL. */
  static createSync(dbPath = DB_PATH): MessageStore {
    console.log(`[message-store] sync init → JSONL fallback: ${FALLBACK_JSONL}`)
    return new MessageStore(new JsonlMessageStore(FALLBACK_JSONL))
  }

  saveMessage(msg: StoredMessage): void                            { this.backend.saveMessage(msg) }
  getMessage(id: string): StoredMessage | null                     { return this.backend.getMessage(id) }
  getThread(t: string, l?: number, o?: number): StoredMessage[]    { return this.backend.getThread(t, l, o) }
  getInbox(h: string, l?: number, o?: number): StoredMessage[]     { return this.backend.getInbox(h, l, o) }
  deleteMessage(id: string): void                                  { this.backend.deleteMessage(id) }
  getStats()                                                       { return this.backend.getStats() }
  getMessagesByParticipant(h: string, l?: number, o?: number): StoredMessage[] {
    return this.backend.getMessagesByParticipant(h, l, o)
  }
  searchMessages(query: string, opts?: SearchOptions): StoredMessage[] {
    return this.backend.searchMessages(query, opts)
  }
}

/**
 * Singleton — starts with JSONL, then upgrades to the env-selected backend.
 * HUB_STORE=sqlite (default): upgrades to sql.js when ready.
 * HUB_STORE=jsonl: stays on JSONL.
 */
export let messageStore = MessageStore.createSync()

MessageStore.create().then(upgraded => {
  messageStore = upgraded
}).catch(() => {
  // Stay on JSONL
})
