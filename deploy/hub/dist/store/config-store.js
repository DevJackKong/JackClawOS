"use strict";
// JackClaw Hub - Config Store
// Persists to ~/.jackclaw/hub/config.json
// 系统/租户/组织/用户配置持久化到 ~/.jackclaw/hub/config.json
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.configStore = exports.ConfigStore = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// ─── Paths / 路径 ───────────────────────────────────────────────────────────────
const HUB_DIR = path_1.default.join(process.env.HOME ?? '~', '.jackclaw', 'hub');
const CONFIG_FILE = path_1.default.join(HUB_DIR, 'app-config.json');
// ─── Helpers / 工具函数 ─────────────────────────────────────────────────────────
function loadJSON(file, fallback) {
    try {
        if (fs_1.default.existsSync(file))
            return JSON.parse(fs_1.default.readFileSync(file, 'utf-8'));
    }
    catch {
        // Ignore broken or missing file / 忽略文件不存在或损坏的情况
    }
    return fallback;
}
function saveJSON(file, data) {
    fs_1.default.mkdirSync(path_1.default.dirname(file), { recursive: true });
    fs_1.default.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}
/**
 * Normalize one config entry from disk.
 * 标准化磁盘中的配置记录，兼容旧数据或脏数据。
 */
function normalizeEntry(input) {
    const key = typeof input.key === 'string' ? input.key.trim() : '';
    const scope = input.scope;
    const scopeId = typeof input.scopeId === 'string' ? input.scopeId.trim() : undefined;
    if (!key)
        return null;
    if (scope !== 'system' && scope !== 'tenant' && scope !== 'org' && scope !== 'user')
        return null;
    return {
        key,
        value: input.value,
        scope,
        scopeId: scopeId || undefined,
        description: typeof input.description === 'string' ? input.description : undefined,
        updatedBy: typeof input.updatedBy === 'string' ? input.updatedBy : undefined,
        updatedAt: typeof input.updatedAt === 'number' && Number.isFinite(input.updatedAt)
            ? input.updatedAt
            : Date.now(),
    };
}
/**
 * Validate scope input.
 * 校验配置作用域是否合法。
 */
function normalizeScope(scope) {
    const normalized = (scope ?? 'system').trim();
    if (normalized === 'system' || normalized === 'tenant' || normalized === 'org' || normalized === 'user') {
        return normalized;
    }
    throw Object.assign(new Error(`invalid config scope: ${scope}`), { status: 400 });
}
/**
 * Build stable unique id for one entry.
 * 为单条配置生成稳定唯一键。
 */
function buildEntryId(key, scope, scopeId) {
    return `${scope}:${scopeId ?? '*'}:${key}`;
}
// ─── ConfigStore / 配置存储 ─────────────────────────────────────────────────────
class ConfigStore {
    file;
    constructor(file = CONFIG_FILE) {
        this.file = file;
    }
    /**
     * Load all config entries from disk.
     * 从磁盘加载全部配置项。
     */
    load() {
        const raw = loadJSON(this.file, []);
        if (!Array.isArray(raw))
            return [];
        return raw
            .map(normalizeEntry)
            .filter((entry) => entry !== null);
    }
    /**
     * Persist all config entries to disk.
     * 将全部配置项写回磁盘。
     */
    save(entries) {
        saveJSON(this.file, entries);
    }
    /**
     * Find one exact config entry by key + scope + scopeId.
     * 按 key + scope + scopeId 精确查找配置项。
     */
    findEntry(entries, key, scope = 'system', scopeId) {
        return entries.find(entry => (entry.key === key
            && entry.scope === scope
            && (entry.scopeId ?? '') === (scopeId ?? '')));
    }
    /**
     * Get one config value by exact scope.
     * 按精确作用域读取配置值。
     */
    get(key, scope, scopeId) {
        const normalizedKey = key.trim();
        if (!normalizedKey)
            return undefined;
        const entry = this.findEntry(this.load(), normalizedKey, normalizeScope(scope), scopeId?.trim() || undefined);
        return entry?.value;
    }
    /**
     * Create or update one config entry.
     * 创建或更新一条配置记录。
     */
    set(key, value, scope, scopeId, updatedBy) {
        const normalizedKey = key.trim();
        if (!normalizedKey)
            throw Object.assign(new Error('config key cannot be empty'), { status: 400 });
        const normalizedScope = normalizeScope(scope);
        const normalizedScopeId = scopeId?.trim() || undefined;
        const normalizedUpdatedBy = updatedBy?.trim() || undefined;
        const now = Date.now();
        const entries = this.load();
        const entryId = buildEntryId(normalizedKey, normalizedScope, normalizedScopeId);
        const existingIndex = entries.findIndex(entry => (buildEntryId(entry.key, entry.scope, entry.scopeId) === entryId));
        const nextEntry = {
            key: normalizedKey,
            value,
            scope: normalizedScope,
            scopeId: normalizedScopeId,
            description: existingIndex >= 0 ? entries[existingIndex].description : undefined,
            updatedBy: normalizedUpdatedBy,
            updatedAt: now,
        };
        if (existingIndex >= 0) {
            entries[existingIndex] = nextEntry;
        }
        else {
            entries.push(nextEntry);
        }
        this.save(entries);
        return nextEntry;
    }
    /**
     * Delete config entries by key and optional scope filter.
     * 按 key 删除配置；可选按 scope/scopeId 限定范围。
     */
    delete(key, scope, scopeId) {
        const normalizedKey = key.trim();
        if (!normalizedKey)
            return false;
        const hasScopeFilter = scope !== undefined;
        const normalizedScope = hasScopeFilter ? normalizeScope(scope) : undefined;
        const normalizedScopeId = scopeId?.trim() || undefined;
        const entries = this.load();
        const nextEntries = entries.filter(entry => {
            if (entry.key !== normalizedKey)
                return true;
            if (normalizedScope !== undefined && entry.scope !== normalizedScope)
                return true;
            if (scopeId !== undefined && (entry.scopeId ?? '') !== (normalizedScopeId ?? ''))
                return true;
            return false;
        });
        if (nextEntries.length === entries.length)
            return false;
        this.save(nextEntries);
        return true;
    }
    /**
     * List config entries with optional scope filter.
     * 列出配置项；可按 scope/scopeId 过滤。
     */
    list(scope, scopeId) {
        const hasScopeFilter = scope !== undefined;
        const normalizedScope = hasScopeFilter ? normalizeScope(scope) : undefined;
        const normalizedScopeId = scopeId?.trim() || undefined;
        return this.load()
            .filter(entry => (normalizedScope ? entry.scope === normalizedScope : true))
            .filter(entry => (scopeId !== undefined ? (entry.scopeId ?? '') === (normalizedScopeId ?? '') : true))
            .sort((a, b) => b.updatedAt - a.updatedAt);
    }
    /**
     * Resolve effective config value by inheritance priority.
     * 按继承优先级解析最终配置：user > org > tenant > system。
     */
    getEffective(key, tenantId, orgId, userId) {
        const normalizedKey = key.trim();
        if (!normalizedKey)
            return undefined;
        const entries = this.load();
        const candidates = [
            { scope: 'user', scopeId: userId?.trim() || undefined },
            { scope: 'org', scopeId: orgId?.trim() || undefined },
            { scope: 'tenant', scopeId: tenantId?.trim() || undefined },
            { scope: 'system' },
        ];
        for (const candidate of candidates) {
            if (candidate.scope !== 'system' && !candidate.scopeId)
                continue;
            const entry = this.findEntry(entries, normalizedKey, candidate.scope, candidate.scopeId);
            if (entry)
                return entry.value;
        }
        return undefined;
    }
}
exports.ConfigStore = ConfigStore;
// Singleton / 单例
exports.configStore = new ConfigStore();
//# sourceMappingURL=config-store.js.map