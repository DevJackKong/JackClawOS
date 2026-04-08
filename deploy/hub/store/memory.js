"use strict";
// Hub 侧 L3 内存存储 — org 共享记忆 + 协作会话 + 跨节点 MemDir 同步
Object.defineProperty(exports, "__esModule", { value: true });
exports.broadcastMemory = broadcastMemory;
exports.getOrgMemories = getOrgMemories;
exports.registerNodeSkills = registerNodeSkills;
exports.findExpertsBySkill = findExpertsBySkill;
exports.createCollabSession = createCollabSession;
exports.getCollabSession = getCollabSession;
exports.syncCollabSession = syncCollabSession;
exports.endCollabSession = endCollabSession;
exports.storeNodeMemDirs = storeNodeMemDirs;
exports.getSharedMemDirs = getSharedMemDirs;
const orgMemories = new Map();
const collabSessions = new Map();
const nodeSkills = new Map();
// ── Org L3 记忆 ──────────────────────────────────────────
function broadcastMemory(entry) {
    orgMemories.set(entry.id, { ...entry, layer: 'L3', scope: 'org' });
}
function getOrgMemories() {
    return [...orgMemories.values()];
}
// ── 技能索引 ─────────────────────────────────────────────
function registerNodeSkills(nodeId, name, skills) {
    nodeSkills.set(nodeId, { nodeId, name, skills });
}
function findExpertsBySkill(skill) {
    const lower = skill.toLowerCase();
    return [...nodeSkills.values()].filter(n => n.skills.some(s => s.toLowerCase().includes(lower)));
}
// ── 协作会话 ─────────────────────────────────────────────
function createCollabSession(state) {
    collabSessions.set(state.id, state);
}
function getCollabSession(id) {
    return collabSessions.get(id);
}
function syncCollabSession(id, entries) {
    const session = collabSessions.get(id);
    if (!session)
        return;
    session.entries.push(...entries);
}
function endCollabSession(id, mode) {
    const session = collabSessions.get(id);
    if (!session)
        return undefined;
    session.status = 'ended';
    session.endMode = mode;
    collabSessions.delete(id);
    return session;
}
// ── 跨节点 MemDir 同步 ─────────────────────────────────────────────────────
/** nodeId → 该节点推送来的 MemDir 条目（project/reference） */
const nodeSyncedMemories = new Map();
/** 存储某节点推送的 MemDir 条目（覆盖旧数据） */
function storeNodeMemDirs(nodeId, entries) {
    nodeSyncedMemories.set(nodeId, entries);
}
/**
 * 返回除 requestingNodeId 以外所有节点的共享 MemDir 条目。
 * 只对外暴露 project/reference 类型（push 端已过滤，此处双重保险）。
 */
function getSharedMemDirs(requestingNodeId) {
    const SYNCABLE = ['project', 'reference'];
    const result = [];
    for (const [nodeId, entries] of nodeSyncedMemories.entries()) {
        if (nodeId === requestingNodeId)
            continue;
        for (const e of entries) {
            if (SYNCABLE.includes(e.type))
                result.push(e);
        }
    }
    return result;
}
//# sourceMappingURL=memory.js.map