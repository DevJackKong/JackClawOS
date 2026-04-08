"use strict";
/**
 * Node Local Message Store — sql.js based
 *
 * Stores received messages locally on the Node side.
 * Three-layer store architecture:
 *   1. Hub store (hub/src/store/message-store.ts) — authoritative
 *   2. Node local store (this file) — local cache + offline access
 *   3. User query entry — CLI / API / PWA reads from here
 *
 * Path: ~/.jackclaw/node/<nodeId>/messages.db
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeLocalStore = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
// sql.js types (reuse Hub's declaration)
let initSqlJs;
try {
    initSqlJs = require('sql.js');
}
catch {
    initSqlJs = null;
}
const CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS messages (
    id          TEXT PRIMARY KEY,
    thread_id   TEXT,
    from_id     TEXT NOT NULL,
    to_id       TEXT NOT NULL,
    type        TEXT NOT NULL,
    content     TEXT NOT NULL,
    status      TEXT DEFAULT 'stored',
    ts          INTEGER NOT NULL,
    encrypted   INTEGER DEFAULT 0,
    metadata    TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_msg_ts ON messages(ts);
  CREATE INDEX IF NOT EXISTS idx_msg_from ON messages(from_id);
  CREATE INDEX IF NOT EXISTS idx_msg_thread ON messages(thread_id);
`;
class NodeLocalStore {
    db = null;
    dbPath;
    dirty = false;
    flushTimer = null;
    ready = false;
    constructor(nodeId) {
        const dir = path_1.default.join(os_1.default.homedir(), '.jackclaw', 'node', nodeId);
        fs_1.default.mkdirSync(dir, { recursive: true });
        this.dbPath = path_1.default.join(dir, 'messages.db');
    }
    async init() {
        if (!initSqlJs) {
            console.warn('[node-local-store] sql.js not available, local store disabled');
            return false;
        }
        try {
            const SQL = await (typeof initSqlJs === 'function' ? initSqlJs() : initSqlJs);
            if (fs_1.default.existsSync(this.dbPath)) {
                const data = fs_1.default.readFileSync(this.dbPath);
                this.db = new SQL.Database(data);
            }
            else {
                this.db = new SQL.Database();
            }
            this.db.run(CREATE_SQL);
            this.ready = true;
            // Auto-flush every 10s
            this.flushTimer = setInterval(() => this.flush(), 10_000);
            this.flushTimer.unref();
            console.log(`[node-local-store] SQLite ready: ${this.dbPath}`);
            return true;
        }
        catch (e) {
            console.warn(`[node-local-store] init failed: ${e.message}`);
            return false;
        }
    }
    /** Save a received message to local store */
    save(msg) {
        if (!this.ready)
            return;
        try {
            this.db.run(`INSERT OR REPLACE INTO messages (id, thread_id, from_id, to_id, type, content, status, ts, encrypted, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [msg.id, msg.threadId ?? null, msg.from, msg.to, msg.type, msg.content,
                msg.status, msg.ts, msg.encrypted ? 1 : 0,
                msg.metadata ? JSON.stringify(msg.metadata) : null]);
            this.dirty = true;
        }
        catch (e) {
            console.error('[node-local-store] save failed:', e);
        }
    }
    /** Get a message by ID */
    get(id) {
        if (!this.ready)
            return null;
        const results = this.db.exec('SELECT * FROM messages WHERE id = ?', [id]);
        if (!results.length || !results[0].values.length)
            return null;
        return this._rowToMsg(results[0].columns, results[0].values[0]);
    }
    /** Get recent messages */
    recent(limit = 50) {
        if (!this.ready)
            return [];
        const results = this.db.exec('SELECT * FROM messages ORDER BY ts DESC LIMIT ?', [limit]);
        if (!results.length)
            return [];
        return results[0].values.map((row) => this._rowToMsg(results[0].columns, row));
    }
    /** Get inbox (messages sent to this node) */
    inbox(toId, limit = 50) {
        if (!this.ready)
            return [];
        const results = this.db.exec('SELECT * FROM messages WHERE to_id = ? ORDER BY ts DESC LIMIT ?', [toId, limit]);
        if (!results.length)
            return [];
        return results[0].values.map((row) => this._rowToMsg(results[0].columns, row));
    }
    /** Get thread messages */
    thread(threadId, limit = 100) {
        if (!this.ready)
            return [];
        const results = this.db.exec('SELECT * FROM messages WHERE thread_id = ? ORDER BY ts ASC LIMIT ?', [threadId, limit]);
        if (!results.length)
            return [];
        return results[0].values.map((row) => this._rowToMsg(results[0].columns, row));
    }
    /** Stats */
    stats() {
        if (!this.ready)
            return { total: 0, threads: 0 };
        const total = this.db.exec('SELECT COUNT(*) FROM messages');
        const threads = this.db.exec('SELECT COUNT(DISTINCT thread_id) FROM messages WHERE thread_id IS NOT NULL');
        return {
            total: total[0]?.values[0]?.[0] ?? 0,
            threads: threads[0]?.values[0]?.[0] ?? 0,
        };
    }
    /** Flush to disk */
    flush() {
        if (!this.ready || !this.dirty)
            return;
        try {
            const data = this.db.export();
            const buf = Buffer.from(data);
            const tmp = this.dbPath + '.tmp';
            fs_1.default.writeFileSync(tmp, buf);
            fs_1.default.renameSync(tmp, this.dbPath);
            this.dirty = false;
        }
        catch (e) {
            console.error('[node-local-store] flush failed:', e);
        }
    }
    /** Close store */
    close() {
        if (this.flushTimer)
            clearInterval(this.flushTimer);
        this.flush();
        if (this.db)
            this.db.close();
        this.ready = false;
    }
    _rowToMsg(columns, values) {
        const obj = {};
        columns.forEach((col, i) => { obj[col] = values[i]; });
        return {
            id: obj.id,
            threadId: obj.thread_id || undefined,
            from: obj.from_id,
            to: obj.to_id,
            type: obj.type,
            content: obj.content,
            status: obj.status,
            ts: obj.ts,
            encrypted: obj.encrypted === 1,
            metadata: obj.metadata ? JSON.parse(obj.metadata) : undefined,
        };
    }
}
exports.NodeLocalStore = NodeLocalStore;
//# sourceMappingURL=local-store.js.map