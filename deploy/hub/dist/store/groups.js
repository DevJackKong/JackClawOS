"use strict";
/**
 * GroupStore — 群组 & 频道持久化存储
 *
 * - 内存 + JSON 文件双写
 * - 支持群组（group）和频道（channel）
 * - 频道：只有 admins 可发消息，其余成员是订阅者
 * - 支持邀请码、消息历史、置顶消息
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.groupStore = exports.GroupStore = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
// ─── Persistence ───────────────────────────────────────────────────────────────
const HUB_DIR = path_1.default.join(process.env.HOME || '~', '.jackclaw', 'hub');
const GROUPS_FILE = path_1.default.join(HUB_DIR, 'groups.json');
const GMESSAGES_FILE = path_1.default.join(HUB_DIR, 'group-messages.json');
function loadJSON(file, def) {
    try {
        if (fs_1.default.existsSync(file))
            return JSON.parse(fs_1.default.readFileSync(file, 'utf-8'));
    }
    catch { /* ignore */ }
    return def;
}
function saveJSON(file, data) {
    fs_1.default.mkdirSync(path_1.default.dirname(file), { recursive: true });
    fs_1.default.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}
// ─── GroupStore ────────────────────────────────────────────────────────────────
class GroupStore {
    groups;
    messages;
    // inviteCode → groupId 快速索引
    inviteIndex;
    constructor() {
        const groupList = loadJSON(GROUPS_FILE, []);
        this.groups = new Map(groupList.map(g => [g.id, g]));
        this.messages = loadJSON(GMESSAGES_FILE, []);
        this.inviteIndex = new Map(groupList.map(g => [g.inviteCode, g.id]));
    }
    // ─── Persistence helpers ────────────────────────────────────────────────────
    persist() {
        saveJSON(GROUPS_FILE, [...this.groups.values()]);
    }
    persistMessages() {
        saveJSON(GMESSAGES_FILE, this.messages);
    }
    // ─── Invite code ───────────────────────────────────────────────────────────
    generateInviteCode() {
        let code;
        do {
            code = crypto_1.default.randomBytes(5).toString('hex').toUpperCase();
        } while (this.inviteIndex.has(code));
        return code;
    }
    // ─── Group CRUD ─────────────────────────────────────────────────────────────
    create(params) {
        const id = crypto_1.default.randomUUID();
        const inviteCode = this.generateInviteCode();
        const now = Date.now();
        // creator 自动加入成员和管理员
        const membersSet = new Set([params.createdBy, ...params.members]);
        const group = {
            id,
            name: params.name,
            type: params.type ?? 'group',
            avatar: params.avatar,
            announcement: undefined,
            createdBy: params.createdBy,
            admins: [params.createdBy],
            members: [...membersSet],
            inviteCode,
            createdAt: now,
            updatedAt: now,
            pinnedMessageIds: [],
        };
        this.groups.set(id, group);
        this.inviteIndex.set(inviteCode, id);
        this.persist();
        return group;
    }
    get(id) {
        return this.groups.get(id) ?? null;
    }
    listForMember(nodeId) {
        return [...this.groups.values()]
            .filter(g => g.members.includes(nodeId))
            .sort((a, b) => b.updatedAt - a.updatedAt);
    }
    update(id, patch) {
        const g = this.groups.get(id);
        if (!g)
            return null;
        if (patch.name !== undefined)
            g.name = patch.name;
        if (patch.avatar !== undefined)
            g.avatar = patch.avatar;
        if (patch.announcement !== undefined)
            g.announcement = patch.announcement;
        g.updatedAt = Date.now();
        this.persist();
        return g;
    }
    // ─── Member management ──────────────────────────────────────────────────────
    addMembers(groupId, nodeIds) {
        const g = this.groups.get(groupId);
        if (!g)
            return null;
        const set = new Set(g.members);
        for (const id of nodeIds)
            set.add(id);
        g.members = [...set];
        g.updatedAt = Date.now();
        this.persist();
        return g;
    }
    removeMember(groupId, nodeId) {
        const g = this.groups.get(groupId);
        if (!g)
            return null;
        g.members = g.members.filter(m => m !== nodeId);
        g.admins = g.admins.filter(a => a !== nodeId);
        g.updatedAt = Date.now();
        this.persist();
        return g;
    }
    isAdmin(groupId, nodeId) {
        return this.groups.get(groupId)?.admins.includes(nodeId) ?? false;
    }
    isMember(groupId, nodeId) {
        return this.groups.get(groupId)?.members.includes(nodeId) ?? false;
    }
    // ─── Invite code join ───────────────────────────────────────────────────────
    joinByInvite(inviteCode, nodeId) {
        const groupId = this.inviteIndex.get(inviteCode);
        if (!groupId)
            return null;
        return this.addMembers(groupId, [nodeId]);
    }
    // ─── Messages ───────────────────────────────────────────────────────────────
    addMessage(params) {
        const msg = {
            id: crypto_1.default.randomUUID(),
            groupId: params.groupId,
            from: params.from,
            content: params.content,
            replyToId: params.replyToId,
            ts: Date.now(),
        };
        this.messages.push(msg);
        // 更新群组 updatedAt
        const g = this.groups.get(params.groupId);
        if (g) {
            g.updatedAt = Date.now();
            this.persist();
        }
        this.persistMessages();
        return msg;
    }
    getMessages(groupId, limit = 50, before) {
        let msgs = this.messages.filter(m => m.groupId === groupId);
        if (before !== undefined)
            msgs = msgs.filter(m => m.ts < before);
        return msgs.sort((a, b) => a.ts - b.ts).slice(-limit);
    }
    // ─── Pin ────────────────────────────────────────────────────────────────────
    pinMessage(groupId, messageId) {
        const g = this.groups.get(groupId);
        if (!g)
            return null;
        if (!g.pinnedMessageIds.includes(messageId)) {
            g.pinnedMessageIds.push(messageId);
            g.updatedAt = Date.now();
            this.persist();
        }
        return g;
    }
}
exports.GroupStore = GroupStore;
// Singleton
exports.groupStore = new GroupStore();
//# sourceMappingURL=groups.js.map