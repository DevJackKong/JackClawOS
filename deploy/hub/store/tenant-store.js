"use strict";
// JackClaw Hub - Tenant Store
// Persists to ~/.jackclaw/hub/tenants.json
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tenantStore = exports.TenantStore = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
// ─── Paths / 路径 ──────────────────────────────────────────────────────────────
const HUB_DIR = path_1.default.join(process.env.HOME ?? '~', '.jackclaw', 'hub');
const TENANTS_FILE = path_1.default.join(HUB_DIR, 'tenants.json');
// ─── Helpers / 工具函数 ────────────────────────────────────────────────────────
function loadJSON(file, fallback) {
    try {
        if (fs_1.default.existsSync(file))
            return JSON.parse(fs_1.default.readFileSync(file, 'utf-8'));
    }
    catch { /* ignore */ }
    return fallback;
}
function saveJSON(file, data) {
    fs_1.default.mkdirSync(path_1.default.dirname(file), { recursive: true });
    fs_1.default.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}
function generateId(bytes = 8) {
    return crypto_1.default.randomBytes(bytes).toString('hex');
}
// ─── TenantStore / 租户存储 ────────────────────────────────────────────────────
class TenantStore {
    load() {
        return loadJSON(TENANTS_FILE, {});
    }
    save(store) {
        saveJSON(TENANTS_FILE, store);
    }
    /**
     * Create tenant with default organization and workspace.
     * 创建租户时自动生成默认组织和默认工作区。
     */
    create(name, slug, plan) {
        const store = this.load();
        const now = Date.now();
        const tenantId = generateId(12);
        const orgId = generateId(10);
        const workspaceId = generateId(10);
        const normalizedName = name.trim();
        const normalizedSlug = slug.trim().toLowerCase();
        const organization = {
            id: orgId,
            tenantId,
            name: `${normalizedName} Org`,
            slug: normalizedSlug,
            createdAt: now,
            updatedAt: now,
        };
        const workspace = {
            id: workspaceId,
            orgId,
            tenantId,
            name: 'Default Workspace',
            slug: 'default',
            createdAt: now,
            updatedAt: now,
        };
        const tenant = {
            id: tenantId,
            name: normalizedName,
            slug: normalizedSlug,
            plan,
            status: 'active',
            createdAt: now,
            updatedAt: now,
            settings: {},
            organizations: [organization],
            workspaces: [workspace],
        };
        store[tenantId] = tenant;
        this.save(store);
        return tenant;
    }
    /**
     * Get tenant by id.
     * 按 id 获取租户。
     */
    get(id) {
        return this.load()[id] ?? null;
    }
    /**
     * List all tenants.
     * 获取全部租户列表。
     */
    list() {
        return Object.values(this.load()).sort((a, b) => b.createdAt - a.createdAt);
    }
    /**
     * Update tenant fields.
     * 更新租户基础字段。
     */
    update(id, updates) {
        const store = this.load();
        const tenant = store[id];
        if (!tenant)
            return null;
        if (updates.name !== undefined)
            tenant.name = updates.name.trim();
        if (updates.slug !== undefined)
            tenant.slug = updates.slug.trim().toLowerCase();
        if (updates.plan !== undefined)
            tenant.plan = updates.plan;
        if (updates.status !== undefined)
            tenant.status = updates.status;
        if (updates.settings !== undefined)
            tenant.settings = updates.settings;
        tenant.updatedAt = Date.now();
        store[id] = tenant;
        this.save(store);
        return tenant;
    }
    /**
     * Delete tenant from store.
     * 从存储中删除租户。
     */
    delete(id) {
        const store = this.load();
        if (!store[id])
            return false;
        delete store[id];
        this.save(store);
        return true;
    }
}
exports.TenantStore = TenantStore;
// Singleton / 单例
exports.tenantStore = new TenantStore();
//# sourceMappingURL=tenant-store.js.map