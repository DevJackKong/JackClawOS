"use strict";
// JackClaw Hub - Member Store
// Persists to ~/.jackclaw/hub/members.json
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.memberStore = exports.MemberStore = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
// ─── Paths / 路径 ───────────────────────────────────────────────────────────────
const HUB_DIR = path_1.default.join(process.env.HOME ?? '~', '.jackclaw', 'hub');
const MEMBERS_FILE = path_1.default.join(HUB_DIR, 'members.json');
// ─── Helpers / 辅助函数 ─────────────────────────────────────────────────────────
/**
 * Load JSON file with fallback.
 * 加载 JSON 文件；失败时返回兜底值。
 */
function loadJSON(file, fallback) {
    try {
        if (fs_1.default.existsSync(file))
            return JSON.parse(fs_1.default.readFileSync(file, 'utf-8'));
    }
    catch {
        // ignore parse/read errors / 忽略读取或解析错误
    }
    return fallback;
}
/**
 * Save JSON file, auto-create parent directory.
 * 保存 JSON 文件，并自动创建父目录。
 */
function saveJSON(file, data) {
    fs_1.default.mkdirSync(path_1.default.dirname(file), { recursive: true });
    fs_1.default.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}
// ─── MemberStore / 成员存储 ─────────────────────────────────────────────────────
class MemberStore {
    /**
     * Load all members from disk.
     * 从磁盘加载全部成员。
     */
    load() {
        return loadJSON(MEMBERS_FILE, []);
    }
    /**
     * Persist all members to disk.
     * 将全部成员持久化到磁盘。
     */
    save(members) {
        saveJSON(MEMBERS_FILE, members);
    }
    /**
     * Add a new member record.
     * 添加成员记录。
     */
    add(tenantId, orgId, userId, role) {
        const members = this.load();
        const now = Date.now();
        const member = {
            id: crypto_1.default.randomUUID(),
            tenantId,
            orgId,
            userId,
            role,
            status: 'active',
            joinedAt: now,
            updatedAt: now,
        };
        members.push(member);
        this.save(members);
        return member;
    }
    /**
     * Get one member by id.
     * 按 id 获取成员。
     */
    get(id) {
        return this.load().find(member => member.id === id) ?? null;
    }
    /**
     * Find member by user within one tenant.
     * 在指定租户内按 userId 查成员。
     */
    getByUser(userId, tenantId) {
        return this.load().find(member => member.userId === userId && member.tenantId === tenantId) ?? null;
    }
    /**
     * List all members under one organization.
     * 列出某个组织下的全部成员。
     */
    listByOrg(orgId) {
        return this.load()
            .filter(member => member.orgId === orgId)
            .sort((a, b) => b.joinedAt - a.joinedAt);
    }
    /**
     * List all members under one tenant.
     * 列出某个租户下的全部成员。
     */
    listByTenant(tenantId) {
        return this.load()
            .filter(member => member.tenantId === tenantId)
            .sort((a, b) => b.joinedAt - a.joinedAt);
    }
    /**
     * Update member role.
     * 更新成员角色。
     */
    updateRole(id, role) {
        const members = this.load();
        const member = members.find(item => item.id === id);
        if (!member)
            return null;
        member.role = role;
        member.updatedAt = Date.now();
        this.save(members);
        return member;
    }
    /**
     * Remove member by id.
     * 按 id 删除成员。
     */
    remove(id) {
        const members = this.load();
        const next = members.filter(member => member.id !== id);
        if (next.length === members.length)
            return false;
        this.save(next);
        return true;
    }
}
exports.MemberStore = MemberStore;
exports.memberStore = new MemberStore();
//# sourceMappingURL=member-store.js.map