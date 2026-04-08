"use strict";
// JackClaw Hub - Trace Store
// Persists to ~/.jackclaw/hub/traces.jsonl (append-only)
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.traceStore = exports.TraceStore = void 0;
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const HUB_DIR = path_1.default.join(os_1.default.homedir(), '.jackclaw', 'hub');
const TRACES_FILE = path_1.default.join(HUB_DIR, 'traces.jsonl');
/**
 * Read JSONL file into memory.
 * 读取 JSONL 文件到内存；坏行自动跳过。
 */
function loadJsonl(file) {
    try {
        if (!fs_1.default.existsSync(file))
            return [];
        const raw = fs_1.default.readFileSync(file, 'utf-8');
        if (!raw.trim())
            return [];
        const entries = [];
        for (const line of raw.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            try {
                entries.push(JSON.parse(trimmed));
            }
            catch {
                // Skip invalid line / 跳过损坏行
            }
        }
        return entries;
    }
    catch {
        return [];
    }
}
/**
 * Append one JSONL record.
 * 追加一条 JSONL 记录。
 */
function appendJsonl(file, entry) {
    fs_1.default.mkdirSync(path_1.default.dirname(file), { recursive: true });
    fs_1.default.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf-8');
}
/**
 * Normalize optional limit.
 * 标准化 limit，避免非法值。
 */
function normalizeLimit(limit) {
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0)
        return 50;
    return Math.floor(limit);
}
/**
 * Sort newest first, then apply limit.
 * 先按时间倒序，再截断数量。
 */
function newestFirst(entries, limit) {
    return [...entries]
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, normalizeLimit(limit));
}
class TraceStore {
    file;
    traces;
    byId;
    constructor(file = TRACES_FILE) {
        this.file = file;
        this.traces = loadJsonl(file);
        this.byId = new Map(this.traces.map(trace => [trace.id, trace]));
    }
    /**
     * Add one trace entry and persist it as append-only JSONL.
     * 添加追踪记录，并以 append-only JSONL 方式持久化。
     */
    add(entry) {
        const trace = {
            ...entry,
            id: crypto_1.default.randomUUID(),
            timestamp: Date.now(),
        };
        appendJsonl(this.file, trace);
        this.traces.push(trace);
        this.byId.set(trace.id, trace);
        return trace;
    }
    /**
     * Get one trace by id.
     * 按 id 获取单条追踪记录。
     */
    get(id) {
        return this.byId.get(id) ?? null;
    }
    /**
     * List traces under one tenant.
     * 按租户列出追踪记录。
     */
    listByTenant(tenantId, limit) {
        return newestFirst(this.traces.filter(trace => trace.tenantId === tenantId), limit);
    }
    /**
     * List traces created by one actor.
     * 按执行者列出追踪记录。
     */
    listByActor(actorId, limit) {
        return newestFirst(this.traces.filter(trace => trace.actorId === actorId), limit);
    }
    /**
     * List traces pointing to one target entity.
     * 按目标实体列出追踪记录。
     */
    listByTarget(targetId, limit) {
        return newestFirst(this.traces.filter(trace => trace.targetId === targetId), limit);
    }
    /**
     * Follow parentTraceId upward and return the full chain.
     * 沿 parentTraceId 向上追溯，返回完整链路。
     */
    getChain(traceId) {
        const chain = [];
        const visited = new Set();
        let current = this.get(traceId);
        while (current && !visited.has(current.id)) {
            chain.push(current);
            visited.add(current.id);
            current = current.parentTraceId ? this.get(current.parentTraceId) : null;
        }
        return chain.reverse();
    }
    /**
     * Search traces by structured conditions.
     * 按结构化条件搜索追踪记录。
     */
    search(query, limit) {
        const { tenantId, type, action, from, to } = query;
        return newestFirst(this.traces.filter(trace => {
            if (tenantId && trace.tenantId !== tenantId)
                return false;
            if (type && trace.type !== type)
                return false;
            if (action && trace.action !== action)
                return false;
            if (typeof from === 'number' && trace.timestamp < from)
                return false;
            if (typeof to === 'number' && trace.timestamp > to)
                return false;
            return true;
        }), limit);
    }
}
exports.TraceStore = TraceStore;
exports.traceStore = new TraceStore();
//# sourceMappingURL=trace-store.js.map