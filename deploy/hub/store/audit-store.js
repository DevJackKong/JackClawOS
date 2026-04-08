"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditStore = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const HUB_DIR = path_1.default.join(process.env.HOME || '~', '.jackclaw', 'hub');
const AUDIT_STORE_FILE = path_1.default.join(HUB_DIR, 'api-audit.jsonl');
/**
 * Lightweight append-only audit store with query support.
 * 轻量级追加写入审计存储，支持查询。
 */
class AuditStore {
    filePath;
    constructor(filePath = AUDIT_STORE_FILE) {
        this.filePath = filePath;
        fs_1.default.mkdirSync(path_1.default.dirname(this.filePath), { recursive: true });
    }
    /**
     * Persist one audit entry as JSONL.
     * 以 JSONL 形式持久化一条审计记录。
     */
    log(entry) {
        const payload = {
            method: entry.method ?? 'POST',
            path: entry.path ?? entry.action ?? '',
            statusCode: entry.statusCode ?? 200,
            result: entry.result ?? 'success',
            ...entry,
            id: entry.id ?? crypto_1.default.randomUUID(),
            timestamp: entry.timestamp ?? Date.now(),
        };
        fs_1.default.appendFileSync(this.filePath, `${JSON.stringify(payload)}\n`, {
            encoding: 'utf-8',
            flag: 'a',
        });
        return payload;
    }
    /**
     * Load all entries from JSONL file.
     * 从 JSONL 文件加载所有记录。
     */
    loadAll() {
        if (!fs_1.default.existsSync(this.filePath))
            return [];
        const lines = fs_1.default.readFileSync(this.filePath, 'utf-8').split('\n').filter(Boolean);
        const entries = [];
        for (const line of lines) {
            try {
                entries.push(JSON.parse(line));
            }
            catch { /* skip bad lines */ }
        }
        return entries;
    }
    /**
     * Get a single entry by id.
     * 按 ID 获取单条记录。
     */
    get(id) {
        return this.loadAll().find(e => e.id === id) ?? null;
    }
    /**
     * Query entries with filters.
     * 按条件查询记录。
     */
    query(opts = {}) {
        let entries = this.loadAll();
        if (opts.tenantId)
            entries = entries.filter(e => e.tenantId === opts.tenantId);
        if (opts.category)
            entries = entries.filter(e => e.category === opts.category);
        if (opts.actorId)
            entries = entries.filter(e => (e.actorId ?? e.userId) === opts.actorId);
        if (opts.action)
            entries = entries.filter(e => (e.action ?? e.path)?.includes(opts.action));
        if (opts.result)
            entries = entries.filter(e => e.result === opts.result);
        if (opts.from)
            entries = entries.filter(e => (e.timestamp ?? 0) >= opts.from);
        if (opts.to)
            entries = entries.filter(e => (e.timestamp ?? 0) <= opts.to);
        // 按时间倒序 / descending by timestamp
        entries.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
        return entries.slice(0, opts.limit ?? 100);
    }
    /**
     * Get stats for a tenant.
     * 获取租户审计统计。
     */
    stats(tenantId, from, to) {
        let entries = this.loadAll();
        if (tenantId)
            entries = entries.filter(e => e.tenantId === tenantId);
        if (from)
            entries = entries.filter(e => (e.timestamp ?? 0) >= from);
        if (to)
            entries = entries.filter(e => (e.timestamp ?? 0) <= to);
        const byResult = {};
        const byMethod = {};
        for (const e of entries) {
            byResult[e.result] = (byResult[e.result] ?? 0) + 1;
            byMethod[e.method] = (byMethod[e.method] ?? 0) + 1;
        }
        return { total: entries.length, byResult, byMethod };
    }
}
exports.auditStore = new AuditStore();
exports.default = exports.auditStore;
//# sourceMappingURL=audit-store.js.map