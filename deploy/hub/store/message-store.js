"use strict";
/**
 * MessageStore — SQLite-backed persistent message storage with FTS5 full-text search.
 * Falls back to JSONL append file if better-sqlite3 is unavailable.
 *
 * DB path: ~/.jackclaw/hub/messages.db
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.messageStore = exports.MessageStore = exports.DB_PATH = void 0;
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const sql_js_1 = __importDefault(require("sql.js"));
const HUB_DIR = path_1.default.join(os_1.default.homedir(), '.jackclaw', 'hub');
const verbose = process.env.DEBUG || process.env.VERBOSE;
function dbg(...args) {
    if (verbose)
        console.log(...args);
    else
        console.debug(...args);
}
exports.DB_PATH = path_1.default.join(HUB_DIR, 'messages.db');
const FALLBACK_JSONL = path_1.default.join(HUB_DIR, 'messages.jsonl');
// ─── Row mapping ──────────────────────────────────────────────────────────────
function row2msg(row) {
    return {
        id: row.id,
        threadId: row.thread_id ?? undefined,
        fromAgent: row.from_agent,
        toAgent: row.to_agent,
        fromHuman: row.from_human ?? undefined,
        content: row.content,
        type: row.type,
        replyTo: row.reply_to ?? undefined,
        attachments: row.attachments
            ? JSON.parse(row.attachments)
            : undefined,
        status: row.status,
        ts: row.ts,
        encrypted: row.encrypted === 1,
        recalled: row.recalled === 1,
        recalledAt: typeof row.recalled_at === 'number' ? row.recalled_at : undefined,
    };
}
function sanitizeFts(q) {
    return `"${q.replace(/"/g, '""')}"`;
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
    encrypted   INTEGER DEFAULT 0,
    recalled    INTEGER DEFAULT 0,
    recalled_at INTEGER
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
];
/**
 * sql.js helper: run a query and return rows as Record<string, unknown>[]
 */
function sqlAll(db, sql, params = []) {
    const stmt = db.prepare(sql);
    if (params.length)
        stmt.bind(params);
    const results = [];
    while (stmt.step()) {
        const row = stmt.getAsObject();
        results.push(row);
    }
    stmt.free();
    return results;
}
function sqlGet(db, sql, params = []) {
    const rows = sqlAll(db, sql, params);
    return rows[0];
}
function sqlRun(db, sql, params = []) {
    db.run(sql, params);
}
class SqliteMessageStore {
    db;
    dbPath;
    _saveTimer = null;
    _dirty = false;
    constructor(dbPath, dbInstance) {
        this.dbPath = dbPath;
        this.db = dbInstance;
        fs_1.default.mkdirSync(path_1.default.dirname(dbPath), { recursive: true });
        for (const sql of CREATE_STMTS) {
            this.db.run(sql);
        }
        try {
            this.db.run('ALTER TABLE messages ADD COLUMN recalled INTEGER DEFAULT 0');
        }
        catch { }
        try {
            this.db.run('ALTER TABLE messages ADD COLUMN recalled_at INTEGER');
        }
        catch { }
        // Auto-save to disk every 5s if dirty
        this._saveTimer = setInterval(() => this._flush(), 5000);
        this._saveTimer.unref();
    }
    _markDirty() {
        this._dirty = true;
    }
    _flush() {
        if (!this._dirty)
            return;
        try {
            const data = this.db.export();
            const buf = Buffer.from(data);
            const tmpFile = this.dbPath + '.tmp';
            fs_1.default.writeFileSync(tmpFile, buf);
            fs_1.default.renameSync(tmpFile, this.dbPath);
            this._dirty = false;
        }
        catch (e) {
            console.error('[message-store] flush to disk failed:', e);
        }
    }
    saveMessage(msg) {
        sqlRun(this.db, `
      INSERT OR REPLACE INTO messages
        (id, thread_id, from_agent, to_agent, from_human, content, type,
         reply_to, attachments, status, ts, encrypted, recalled, recalled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            msg.recalled ? 1 : 0,
            msg.recalledAt ?? null,
        ]);
        // Keep FTS in sync
        sqlRun(this.db, `DELETE FROM messages_fts WHERE message_id = ?`, [msg.id]);
        sqlRun(this.db, `
      INSERT INTO messages_fts (message_id, content, from_agent, to_agent)
      VALUES (?, ?, ?, ?)
    `, [msg.id, msg.content, msg.fromAgent, msg.toAgent]);
        if (msg.threadId) {
            sqlRun(this.db, `
        INSERT INTO threads (id, participants, last_message_at, message_count)
        VALUES (?, '[]', ?, 1)
        ON CONFLICT(id) DO UPDATE SET
          last_message_at = excluded.last_message_at,
          message_count   = message_count + 1
      `, [msg.threadId, msg.ts]);
        }
        this._markDirty();
    }
    getMessage(id) {
        const row = sqlGet(this.db, `SELECT * FROM messages WHERE id = ?`, [id]);
        return row ? row2msg(row) : null;
    }
    getThread(threadId, limit = 50, offset = 0) {
        return sqlAll(this.db, `SELECT * FROM messages WHERE thread_id = ? ORDER BY ts ASC LIMIT ? OFFSET ?`, [threadId, limit, offset]).map(row2msg);
    }
    getMessagesByParticipant(agentHandle, limit = 50, offset = 0) {
        return sqlAll(this.db, `
      SELECT * FROM messages
      WHERE from_agent = ? OR to_agent = ?
      ORDER BY ts DESC LIMIT ? OFFSET ?
    `, [agentHandle, agentHandle, limit, offset]).map(row2msg);
    }
    searchMessages(query, opts = {}) {
        const { from, to, after, before, limit = 20, offset = 0 } = opts;
        let sql = `
      SELECT m.* FROM messages m
      WHERE m.id IN (
        SELECT message_id FROM messages_fts WHERE messages_fts MATCH ?
      )
    `;
        const params = [sanitizeFts(query)];
        if (from) {
            sql += ` AND m.from_agent = ?`;
            params.push(from);
        }
        if (to) {
            sql += ` AND m.to_agent = ?`;
            params.push(to);
        }
        if (after) {
            sql += ` AND m.ts > ?`;
            params.push(after);
        }
        if (before) {
            sql += ` AND m.ts < ?`;
            params.push(before);
        }
        sql += ` ORDER BY m.ts DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);
        try {
            return sqlAll(this.db, sql, params).map(row2msg);
        }
        catch {
            // FTS query failed — fall back to LIKE
            const likeSql = `
        SELECT * FROM messages
        WHERE content LIKE ?
        ${from ? ' AND from_agent = ?' : ''}
        ${to ? ' AND to_agent = ?' : ''}
        ${after ? ' AND ts > ?' : ''}
        ${before ? ' AND ts < ?' : ''}
        ORDER BY ts DESC LIMIT ? OFFSET ?
      `;
            const likeParams = [`%${query}%`];
            if (from)
                likeParams.push(from);
            if (to)
                likeParams.push(to);
            if (after)
                likeParams.push(after);
            if (before)
                likeParams.push(before);
            likeParams.push(limit, offset);
            return sqlAll(this.db, likeSql, likeParams).map(row2msg);
        }
    }
    getInbox(agentHandle, limit = 20, offset = 0) {
        return sqlAll(this.db, `SELECT * FROM messages WHERE to_agent = ? ORDER BY ts DESC LIMIT ? OFFSET ?`, [agentHandle, limit, offset]).map(row2msg);
    }
    markMessageRecalled(id, recalledAt) {
        const current = this.getMessage(id);
        if (!current)
            return null;
        const updated = { ...current, recalled: true, recalledAt, status: 'recalled' };
        this.saveMessage(updated);
        return updated;
    }
    deleteMessage(id) {
        sqlRun(this.db, `DELETE FROM messages_fts WHERE message_id = ?`, [id]);
        sqlRun(this.db, `DELETE FROM messages WHERE id = ?`, [id]);
        this._markDirty();
    }
    getStats() {
        const msgsRow = sqlGet(this.db, `SELECT COUNT(*) as n FROM messages`);
        const threadsRow = sqlGet(this.db, `SELECT COUNT(*) as n FROM threads`);
        return {
            totalMessages: msgsRow?.n ?? 0,
            totalThreads: threadsRow?.n ?? 0,
        };
    }
}
// ─── JSONL fallback backend ───────────────────────────────────────────────────
class JsonlMessageStore {
    file;
    messages = [];
    constructor(file) {
        this.file = file;
        fs_1.default.mkdirSync(path_1.default.dirname(file), { recursive: true });
        this._load();
    }
    _load() {
        if (!fs_1.default.existsSync(this.file))
            return;
        try {
            const lines = fs_1.default.readFileSync(this.file, 'utf-8').trim().split('\n').filter(Boolean);
            this.messages = lines.map(l => JSON.parse(l));
        }
        catch { /* start empty */ }
    }
    _rewrite() {
        fs_1.default.writeFileSync(this.file, this.messages.map(m => JSON.stringify(m)).join('\n') + '\n');
    }
    saveMessage(msg) {
        const idx = this.messages.findIndex(m => m.id === msg.id);
        if (idx >= 0) {
            this.messages[idx] = msg;
            this._rewrite();
        }
        else {
            this.messages.push(msg);
            fs_1.default.appendFileSync(this.file, JSON.stringify(msg) + '\n');
        }
    }
    getMessage(id) {
        return this.messages.find(m => m.id === id) ?? null;
    }
    getThread(threadId, limit = 50, offset = 0) {
        return this.messages
            .filter(m => m.threadId === threadId)
            .sort((a, b) => a.ts - b.ts)
            .slice(offset, offset + limit);
    }
    getMessagesByParticipant(agentHandle, limit = 50, offset = 0) {
        return this.messages
            .filter(m => m.fromAgent === agentHandle || m.toAgent === agentHandle)
            .sort((a, b) => b.ts - a.ts)
            .slice(offset, offset + limit);
    }
    searchMessages(query, opts = {}) {
        const { from, to, after, before, limit = 20, offset = 0 } = opts;
        const q = query.toLowerCase();
        return this.messages
            .filter(m => m.content.toLowerCase().includes(q) &&
            (!from || m.fromAgent === from) &&
            (!to || m.toAgent === to) &&
            (!after || m.ts > after) &&
            (!before || m.ts < before))
            .sort((a, b) => b.ts - a.ts)
            .slice(offset, offset + limit);
    }
    getInbox(agentHandle, limit = 20, offset = 0) {
        return this.messages
            .filter(m => m.toAgent === agentHandle)
            .sort((a, b) => b.ts - a.ts)
            .slice(offset, offset + limit);
    }
    markMessageRecalled(id, recalledAt) {
        const idx = this.messages.findIndex(m => m.id === id);
        if (idx < 0)
            return null;
        this.messages[idx] = { ...this.messages[idx], recalled: true, recalledAt, status: 'recalled' };
        this._rewrite();
        return this.messages[idx];
    }
    deleteMessage(id) {
        this.messages = this.messages.filter(m => m.id !== id);
        this._rewrite();
    }
    getStats() {
        const threads = new Set(this.messages.filter(m => m.threadId).map(m => m.threadId));
        return { totalMessages: this.messages.length, totalThreads: threads.size };
    }
}
class MessageStore {
    backend;
    constructor(backend) {
        this.backend = backend;
    }
    /**
     * Create a MessageStore.
     * Respects HUB_STORE env var: 'jsonl' forces JSONL; anything else (default: 'sqlite') tries sql.js.
     */
    static async create(dbPath = exports.DB_PATH) {
        const storeEnv = (process.env.HUB_STORE ?? 'sqlite').toLowerCase();
        if (storeEnv === 'jsonl') {
            dbg(`[message-store] HUB_STORE=jsonl → JSONL backend: ${FALLBACK_JSONL}`);
            return new MessageStore(new JsonlMessageStore(FALLBACK_JSONL));
        }
        try {
            const SQL = await (0, sql_js_1.default)();
            let dbInstance;
            // Load existing DB from disk if present
            if (fs_1.default.existsSync(dbPath)) {
                const fileData = fs_1.default.readFileSync(dbPath);
                dbInstance = new SQL.Database(fileData);
            }
            else {
                dbInstance = new SQL.Database();
            }
            const backend = new SqliteMessageStore(dbPath, dbInstance);
            dbg(`[message-store] HUB_STORE=sqlite → sql.js backend: ${dbPath}`);
            return new MessageStore(backend);
        }
        catch (err) {
            dbg(`[message-store] sql.js unavailable (${err.message}), ` +
                `using JSONL fallback: ${FALLBACK_JSONL}`);
            return new MessageStore(new JsonlMessageStore(FALLBACK_JSONL));
        }
    }
    /** Synchronous fallback constructor for backward compat. Uses JSONL. */
    static createSync(dbPath = exports.DB_PATH) {
        dbg(`[message-store] sync init → JSONL fallback: ${FALLBACK_JSONL}`);
        return new MessageStore(new JsonlMessageStore(FALLBACK_JSONL));
    }
    saveMessage(msg) { this.backend.saveMessage(msg); }
    getMessage(id) { return this.backend.getMessage(id); }
    getThread(t, l, o) { return this.backend.getThread(t, l, o); }
    getInbox(h, l, o) { return this.backend.getInbox(h, l, o); }
    markMessageRecalled(id, recalledAt) { return this.backend.markMessageRecalled(id, recalledAt); }
    deleteMessage(id) { this.backend.deleteMessage(id); }
    getStats() { return this.backend.getStats(); }
    getMessagesByParticipant(h, l, o) {
        return this.backend.getMessagesByParticipant(h, l, o);
    }
    searchMessages(query, opts) {
        return this.backend.searchMessages(query, opts);
    }
}
exports.MessageStore = MessageStore;
/**
 * Singleton — starts with JSONL, then upgrades to the env-selected backend.
 * HUB_STORE=sqlite (default): upgrades to sql.js when ready.
 * HUB_STORE=jsonl: stays on JSONL.
 */
exports.messageStore = MessageStore.createSync();
MessageStore.create().then(upgraded => {
    exports.messageStore = upgraded;
}).catch(() => {
    // Stay on JSONL
});
//# sourceMappingURL=message-store.js.map