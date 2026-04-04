/**
 * MessageStore — SQLite-backed persistent message storage with FTS5 full-text search.
 * Falls back to JSONL append file if better-sqlite3 is unavailable.
 *
 * DB path: ~/.jackclaw/hub/messages.db
 */

import fs from 'fs'
import os from 'os'
import path from 'path'

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

class SqliteMessageStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    // Dynamic require so missing native module triggers JSONL fallback
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3') as typeof import('better-sqlite3')
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    for (const sql of CREATE_STMTS) {
      this.db.prepare(sql).run()
    }
  }

  saveMessage(msg: StoredMessage): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO messages
        (id, thread_id, from_agent, to_agent, from_human, content, type,
         reply_to, attachments, status, ts, encrypted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
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
    )
    // Keep FTS in sync
    this.db.prepare(`DELETE FROM messages_fts WHERE message_id = ?`).run(msg.id)
    this.db.prepare(`
      INSERT INTO messages_fts (message_id, content, from_agent, to_agent)
      VALUES (?, ?, ?, ?)
    `).run(msg.id, msg.content, msg.fromAgent, msg.toAgent)

    if (msg.threadId) {
      this.db.prepare(`
        INSERT INTO threads (id, participants, last_message_at, message_count)
        VALUES (?, '[]', ?, 1)
        ON CONFLICT(id) DO UPDATE SET
          last_message_at = excluded.last_message_at,
          message_count   = message_count + 1
      `).run(msg.threadId, msg.ts)
    }
  }

  getMessage(id: string): StoredMessage | null {
    const row = this.db.prepare(`SELECT * FROM messages WHERE id = ?`).get(id) as
      Record<string, unknown> | undefined
    return row ? row2msg(row) : null
  }

  getThread(threadId: string, limit = 50, offset = 0): StoredMessage[] {
    return (this.db.prepare(
      `SELECT * FROM messages WHERE thread_id = ? ORDER BY ts ASC LIMIT ? OFFSET ?`,
    ).all(threadId, limit, offset) as Record<string, unknown>[]).map(row2msg)
  }

  getMessagesByParticipant(agentHandle: string, limit = 50, offset = 0): StoredMessage[] {
    return (this.db.prepare(`
      SELECT * FROM messages
      WHERE from_agent = ? OR to_agent = ?
      ORDER BY ts DESC LIMIT ? OFFSET ?
    `).all(agentHandle, agentHandle, limit, offset) as Record<string, unknown>[]).map(row2msg)
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
      return (this.db.prepare(sql).all(...params) as Record<string, unknown>[]).map(row2msg)
    } catch {
      // Malformed FTS query — fall back to LIKE
      const likeSql = sql.replace(
        `m.id IN (\n        SELECT message_id FROM messages_fts WHERE messages_fts MATCH ?\n      )`,
        `m.content LIKE ?`,
      )
      params[0] = `%${query}%`
      return (this.db.prepare(likeSql).all(...params) as Record<string, unknown>[]).map(row2msg)
    }
  }

  getInbox(agentHandle: string, limit = 20, offset = 0): StoredMessage[] {
    return (this.db.prepare(
      `SELECT * FROM messages WHERE to_agent = ? ORDER BY ts DESC LIMIT ? OFFSET ?`,
    ).all(agentHandle, limit, offset) as Record<string, unknown>[]).map(row2msg)
  }

  deleteMessage(id: string): void {
    this.db.prepare(`DELETE FROM messages_fts WHERE message_id = ?`).run(id)
    this.db.prepare(`DELETE FROM messages WHERE id = ?`).run(id)
  }

  getStats(): { totalMessages: number; totalThreads: number } {
    const msgs    = (this.db.prepare(`SELECT COUNT(*) as n FROM messages`).get() as { n: number }).n
    const threads = (this.db.prepare(`SELECT COUNT(*) as n FROM threads`).get() as { n: number }).n
    return { totalMessages: msgs, totalThreads: threads }
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

  constructor(dbPath = DB_PATH) {
    try {
      this.backend = new SqliteMessageStore(dbPath)
      console.log(`[message-store] SQLite backend: ${dbPath}`)
    } catch (err) {
      console.warn(
        `[message-store] SQLite unavailable (${(err as Error).message}), ` +
        `using JSONL fallback: ${FALLBACK_JSONL}`,
      )
      this.backend = new JsonlMessageStore(FALLBACK_JSONL)
    }
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

/** Singleton shared across chat + social routes */
export const messageStore = new MessageStore()
