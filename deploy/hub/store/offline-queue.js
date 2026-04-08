"use strict";
/**
 * JackClaw Hub - Unified Offline Queue (WAL-based)
 *
 * Persists queued messages for offline handles.
 * Keyed by target @handle (not nodeId) so messages survive node ID changes.
 *
 * Storage strategy:
 *   - Write-Ahead Log (WAL): appendFileSync for every enqueue/dequeue op
 *   - Periodic compaction: rebuild full state file from WAL
 *   - Atomic rename on compaction: crash-safe
 *
 * Each enqueued item is a { event, data } envelope ready to be sent over WS.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.offlineQueue = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const HUB_DIR = path_1.default.join(os_1.default.homedir(), '.jackclaw', 'hub');
const QUEUE_FILE = path_1.default.join(HUB_DIR, 'offline-queue.json');
const WAL_FILE = path_1.default.join(HUB_DIR, 'offline-queue.wal');
const COMPACT_THRESHOLD = 100; // compact after this many WAL entries
const COMPACT_INTERVAL = 5 * 60_000; // or every 5 minutes
class OfflineQueue {
    queue;
    walCount = 0;
    compactTimer = null;
    constructor() {
        fs_1.default.mkdirSync(HUB_DIR, { recursive: true });
        // 1. Load base snapshot
        this.queue = this._loadSnapshot();
        // 2. Replay WAL on top
        this._replayWal();
        // 3. Start periodic compaction
        this.compactTimer = setInterval(() => this._compact(), COMPACT_INTERVAL);
        this.compactTimer.unref();
    }
    /** Add a message to the offline queue for a target handle. */
    enqueue(targetHandle, message) {
        const key = this._key(targetHandle);
        const q = this.queue[key] ?? [];
        q.push(message);
        this.queue[key] = q;
        this._appendWal({ op: 'enqueue', handle: key, envelope: message, ts: Date.now() });
    }
    /** Drain (remove and return) all queued messages for a handle. */
    dequeue(targetHandle) {
        const key = this._key(targetHandle);
        const msgs = this.queue[key] ?? [];
        if (msgs.length > 0) {
            delete this.queue[key];
            this._appendWal({ op: 'dequeue', handle: key, ts: Date.now() });
        }
        return msgs;
    }
    /** Count pending messages without consuming them. */
    peek(targetHandle) {
        return (this.queue[this._key(targetHandle)] ?? []).length;
    }
    /** Total queued messages across all handles. */
    totalPending() {
        return Object.values(this.queue).reduce((sum, q) => sum + q.length, 0);
    }
    _key(handle) {
        return handle.startsWith('@') ? handle : `@${handle}`;
    }
    // ─── WAL operations ──────────────────────────────────────────────────────────
    _appendWal(entry) {
        try {
            fs_1.default.appendFileSync(WAL_FILE, JSON.stringify(entry) + '\n');
            this.walCount++;
            if (this.walCount >= COMPACT_THRESHOLD) {
                this._compact();
            }
        }
        catch (e) {
            console.error('[offline-queue] WAL append failed:', e);
            // Fallback: write full snapshot
            this._writeSnapshot();
        }
    }
    _replayWal() {
        if (!fs_1.default.existsSync(WAL_FILE))
            return;
        try {
            const data = fs_1.default.readFileSync(WAL_FILE, 'utf-8');
            const lines = data.trim().split('\n').filter(Boolean);
            for (const line of lines) {
                try {
                    const entry = JSON.parse(line);
                    if (entry.op === 'enqueue' && entry.envelope) {
                        const q = this.queue[entry.handle] ?? [];
                        q.push(entry.envelope);
                        this.queue[entry.handle] = q;
                    }
                    else if (entry.op === 'dequeue') {
                        delete this.queue[entry.handle];
                    }
                }
                catch { /* skip corrupt line */ }
            }
            this.walCount = lines.length;
        }
        catch { /* WAL unreadable, state is snapshot-only */ }
    }
    // ─── Compaction ───────────────────────────────────────────────────────────────
    _compact() {
        if (this.walCount === 0)
            return;
        try {
            this._writeSnapshot();
            // Truncate WAL after successful snapshot
            fs_1.default.writeFileSync(WAL_FILE, '');
            this.walCount = 0;
        }
        catch (e) {
            console.error('[offline-queue] Compaction failed:', e);
        }
    }
    _writeSnapshot() {
        const tmpFile = QUEUE_FILE + '.tmp';
        fs_1.default.writeFileSync(tmpFile, JSON.stringify(this.queue, null, 2), 'utf-8');
        fs_1.default.renameSync(tmpFile, QUEUE_FILE); // atomic rename
    }
    _loadSnapshot() {
        try {
            if (fs_1.default.existsSync(QUEUE_FILE)) {
                return JSON.parse(fs_1.default.readFileSync(QUEUE_FILE, 'utf-8'));
            }
        }
        catch { /* start empty */ }
        return {};
    }
}
exports.offlineQueue = new OfflineQueue();
//# sourceMappingURL=offline-queue.js.map