"use strict";
// JackClaw Hub - Organization Store
// Persists to ~/.jackclaw/hub/organizations.json
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.orgStore = exports.OrgStore = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
// ─── Paths / 路径 ───────────────────────────────────────────────────────────────
const HUB_DIR = path_1.default.join(process.env.HOME ?? '~', '.jackclaw', 'hub');
const ORGS_FILE = path_1.default.join(HUB_DIR, 'organizations.json');
// ─── Helpers / 工具函数 ─────────────────────────────────────────────────────────
/**
 * Load JSON file with fallback value.
 * 读取 JSON 文件；若不存在或损坏则返回兜底值。
 */
function loadJSON(file, fallback) {
    try {
        if (fs_1.default.existsSync(file))
            return JSON.parse(fs_1.default.readFileSync(file, 'utf-8'));
    }
    catch {
        // ignore invalid JSON / 忽略损坏 JSON
    }
    return fallback;
}
/**
 * Save JSON file to disk.
 * 保存 JSON 文件到磁盘。
 */
function saveJSON(file, data) {
    fs_1.default.mkdirSync(path_1.default.dirname(file), { recursive: true });
    fs_1.default.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}
// ─── OrgStore / 组织存储 ───────────────────────────────────────────────────────
class OrgStore {
    /**
     * Load all organizations keyed by id.
     * 按 id 加载全部组织记录。
     */
    load() {
        return loadJSON(ORGS_FILE, {});
    }
    /**
     * Persist organization store.
     * 持久化组织存储。
     */
    save(store) {
        saveJSON(ORGS_FILE, store);
    }
    /**
     * Create a new organization.
     * 创建新组织。
     */
    create(tenantId, name, slug) {
        const store = this.load();
        const now = Date.now();
        const id = crypto_1.default.randomUUID();
        const org = {
            id,
            tenantId: tenantId.trim(),
            name: name.trim(),
            slug: slug.trim(),
            createdAt: now,
            updatedAt: now,
        };
        store[id] = org;
        this.save(store);
        return org;
    }
    /**
     * Get organization by id.
     * 按 id 获取组织。
     */
    get(id) {
        const org = this.load()[id];
        return org ?? null;
    }
    /**
     * List organizations under one tenant.
     * 列出某个租户下的所有组织。
     */
    listByTenant(tenantId) {
        return Object.values(this.load())
            .filter(org => org.tenantId === tenantId)
            .sort((a, b) => b.createdAt - a.createdAt);
    }
    /**
     * Update organization fields.
     * 更新组织字段。
     */
    update(id, updates) {
        const store = this.load();
        const org = store[id];
        if (!org)
            return null;
        if (updates.name !== undefined)
            org.name = updates.name.trim();
        if (updates.slug !== undefined)
            org.slug = updates.slug.trim();
        org.updatedAt = Date.now();
        store[id] = org;
        this.save(store);
        return org;
    }
    /**
     * Delete organization by id.
     * 按 id 删除组织。
     */
    delete(id) {
        const store = this.load();
        if (!(id in store))
            return false;
        delete store[id];
        this.save(store);
        return true;
    }
}
exports.OrgStore = OrgStore;
// Singleton / 单例导出
exports.orgStore = new OrgStore();
//# sourceMappingURL=org-store.js.map