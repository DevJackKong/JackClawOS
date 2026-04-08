"use strict";
// JackClaw Hub - Workspace Store
// Persists to ~/.jackclaw/hub/workspaces.json
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.workspaceStore = exports.WorkspaceStore = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
// 存储目录 / Storage directory
const HUB_DIR = path_1.default.join(process.env.HOME ?? '~', '.jackclaw', 'hub');
const WORKSPACES_FILE = path_1.default.join(HUB_DIR, 'workspaces.json');
// 读取 JSON 文件，不存在或损坏时返回默认值
// Read JSON file, return fallback if missing or invalid
function loadJSON(file, fallback) {
    try {
        if (fs_1.default.existsSync(file))
            return JSON.parse(fs_1.default.readFileSync(file, 'utf-8'));
    }
    catch {
        // ignore parse/read errors
    }
    return fallback;
}
// 保存 JSON 文件，自动创建目录
// Save JSON file and create parent directory automatically
function saveJSON(file, data) {
    fs_1.default.mkdirSync(path_1.default.dirname(file), { recursive: true });
    fs_1.default.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}
class WorkspaceStore {
    // 加载全部 workspace，内部以 id 为 key
    // Load all workspaces keyed by id
    load() {
        return loadJSON(WORKSPACES_FILE, {});
    }
    // 持久化全部 workspace
    // Persist all workspaces to disk
    save(store) {
        saveJSON(WORKSPACES_FILE, store);
    }
    // 创建 workspace，自动生成 id 与时间戳
    // Create workspace with auto-generated id and timestamps
    create(orgId, tenantId, name, slug) {
        const store = this.load();
        const now = Date.now();
        const workspace = {
            id: crypto_1.default.randomUUID(),
            orgId,
            tenantId,
            name: name.trim(),
            slug: slug.trim(),
            createdAt: now,
            updatedAt: now,
        };
        store[workspace.id] = workspace;
        this.save(store);
        return workspace;
    }
    // 按 id 获取单个 workspace
    // Get one workspace by id
    get(id) {
        return this.load()[id] ?? null;
    }
    // 获取某个组织下的全部 workspace
    // List all workspaces under one organization
    listByOrg(orgId) {
        return Object.values(this.load())
            .filter(workspace => workspace.orgId === orgId)
            .sort((a, b) => b.createdAt - a.createdAt);
    }
    // 获取某个租户下的全部 workspace
    // List all workspaces under one tenant
    listByTenant(tenantId) {
        return Object.values(this.load())
            .filter(workspace => workspace.tenantId === tenantId)
            .sort((a, b) => b.createdAt - a.createdAt);
    }
    // 更新 workspace，返回更新后的对象；不存在返回 null
    // Update workspace and return updated object; return null if not found
    update(id, updates) {
        const store = this.load();
        const workspace = store[id];
        if (!workspace)
            return null;
        if (updates.orgId !== undefined)
            workspace.orgId = updates.orgId;
        if (updates.tenantId !== undefined)
            workspace.tenantId = updates.tenantId;
        if (updates.name !== undefined)
            workspace.name = updates.name.trim();
        if (updates.slug !== undefined)
            workspace.slug = updates.slug.trim();
        workspace.updatedAt = Date.now();
        store[id] = workspace;
        this.save(store);
        return workspace;
    }
    // 删除 workspace，成功返回 true，不存在返回 false
    // Delete workspace, return true if deleted, false if not found
    delete(id) {
        const store = this.load();
        if (!(id in store))
            return false;
        delete store[id];
        this.save(store);
        return true;
    }
}
exports.WorkspaceStore = WorkspaceStore;
// 单例导出 / Singleton export
exports.workspaceStore = new WorkspaceStore();
//# sourceMappingURL=workspace-store.js.map