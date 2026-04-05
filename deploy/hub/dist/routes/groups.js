"use strict";
/**
 * Hub Groups & Channels Routes
 *
 * POST   /api/groups/create              — 创建群组/频道
 * GET    /api/groups/list                — 我的群组列表
 * GET    /api/groups/:id                 — 群组详情
 * POST   /api/groups/:id/members        — 添加成员
 * DELETE /api/groups/:id/members/:nodeId — 移除成员
 * PATCH  /api/groups/:id                 — 修改群组信息
 * POST   /api/groups/:id/message        — 发群消息
 * GET    /api/groups/:id/messages       — 群消息历史
 * POST   /api/groups/:id/pin            — 置顶消息
 * POST   /api/groups/join/:inviteCode   — 通过邀请码加入
 *
 * 频道规则：
 *   - type='channel' 时只有 admins 可以发消息
 *   - 普通成员是订阅者（只读）
 *   - replyToId 支持频道消息评论/回复
 *
 * 认证：使用 jwtPayload（由 server.ts 中的 jwtAuthMiddleware 注入）
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const groups_1 = require("../store/groups");
const chat_1 = require("./chat");
const chat_2 = require("../store/chat");
const quota_1 = require("../quota");
const router = (0, express_1.Router)();
// 复用 ChatStore 做离线队列（群消息推送）
const chatStore = new chat_2.ChatStore();
// ─── Helper ───────────────────────────────────────────────────────────────────
/** 从 JWT payload 取 nodeId */
function getNodeId(req) {
    return req.jwtPayload?.nodeId ?? null;
}
/** 向群成员推送事件（在线 WS，否则进离线队列） */
function broadcastToGroup(groupId, excludeNodeId, event, data) {
    const group = groups_1.groupStore.get(groupId);
    if (!group)
        return;
    for (const memberId of group.members) {
        if (memberId === excludeNodeId)
            continue;
        const sent = (0, chat_1.pushToNodeWs)(memberId, event, data);
        if (!sent) {
            // 构造最简离线消息入队
            chatStore.queueForOffline(memberId, {
                id: data.id ?? `${event}-${Date.now()}`,
                from: excludeNodeId,
                to: memberId,
                type: 'broadcast',
                content: JSON.stringify(data),
                ts: Date.now(),
                signature: '',
                encrypted: false,
                metadata: { groupEvent: event, groupId },
            });
        }
    }
}
// ─── POST /join/:inviteCode (must come before /:id routes) ───────────────────
router.post('/join/:inviteCode', (req, res) => {
    const nodeId = getNodeId(req);
    if (!nodeId) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const group = groups_1.groupStore.joinByInvite(req.params.inviteCode, nodeId);
    if (!group) {
        res.status(404).json({ error: 'invite_code_not_found' });
        return;
    }
    broadcastToGroup(group.id, nodeId, 'group_member_joined', { groupId: group.id, nodeId });
    res.json({ status: 'ok', group });
});
// ─── POST /create ─────────────────────────────────────────────────────────────
router.post('/create', (req, res) => {
    const nodeId = getNodeId(req);
    if (!nodeId) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const { name, members, avatar, type } = req.body;
    if (!name || typeof name !== 'string') {
        res.status(400).json({ error: 'name required' });
        return;
    }
    if (type && type !== 'group' && type !== 'channel') {
        res.status(400).json({ error: 'type must be group or channel' });
        return;
    }
    // ── Quota check: maxGroups per node ────────────────────────────────────────
    const existingGroups = groups_1.groupStore.listForMember(nodeId);
    const createdByNode = existingGroups.filter(g => g.createdBy === nodeId);
    const groupQuota = quota_1.quotaManager.checkQuota(nodeId, 'maxGroups', 1);
    // Sync stored count so the quota reflects reality
    quota_1.quotaManager.setUsage(nodeId, 'maxGroups', createdByNode.length);
    if (!groupQuota.allowed || createdByNode.length >= groupQuota.limit) {
        res.status(429).json({
            error: 'quota_exceeded',
            message: `已达到群组上限 (${groupQuota.limit})`,
            limit: groupQuota.limit,
            used: createdByNode.length,
        });
        return;
    }
    // ── End quota check ─────────────────────────────────────────────────────────
    const group = groups_1.groupStore.create({
        name,
        members: Array.isArray(members) ? members : [],
        createdBy: nodeId,
        avatar,
        type: type ?? 'group',
    });
    console.log(`[groups] Created ${group.type} "${group.name}" by ${nodeId}`);
    res.status(201).json({ status: 'ok', group });
});
// ─── GET /list ────────────────────────────────────────────────────────────────
router.get('/list', (req, res) => {
    const nodeId = getNodeId(req);
    if (!nodeId) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const groups = groups_1.groupStore.listForMember(nodeId);
    res.json({ groups, count: groups.length });
});
// ─── GET /:id ─────────────────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
    const nodeId = getNodeId(req);
    if (!nodeId) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const group = groups_1.groupStore.get(req.params.id);
    if (!group) {
        res.status(404).json({ error: 'group_not_found' });
        return;
    }
    if (!group.members.includes(nodeId)) {
        res.status(403).json({ error: 'not_a_member' });
        return;
    }
    res.json({ group });
});
// ─── POST /:id/members ────────────────────────────────────────────────────────
router.post('/:id/members', (req, res) => {
    const nodeId = getNodeId(req);
    if (!nodeId) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const group = groups_1.groupStore.get(req.params.id);
    if (!group) {
        res.status(404).json({ error: 'group_not_found' });
        return;
    }
    if (!group.admins.includes(nodeId)) {
        res.status(403).json({ error: 'admin_only' });
        return;
    }
    const { nodeIds } = req.body;
    if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
        res.status(400).json({ error: 'nodeIds array required' });
        return;
    }
    const updated = groups_1.groupStore.addMembers(req.params.id, nodeIds);
    broadcastToGroup(req.params.id, nodeId, 'group_members_added', { groupId: req.params.id, nodeIds });
    res.json({ status: 'ok', group: updated });
});
// ─── DELETE /:id/members/:nodeId ──────────────────────────────────────────────
router.delete('/:id/members/:memberId', (req, res) => {
    const nodeId = getNodeId(req);
    if (!nodeId) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const group = groups_1.groupStore.get(req.params.id);
    if (!group) {
        res.status(404).json({ error: 'group_not_found' });
        return;
    }
    // 管理员可移除任意成员；普通成员只能退出自己
    const targetId = req.params.memberId;
    const isSelf = targetId === nodeId;
    if (!isSelf && !group.admins.includes(nodeId)) {
        res.status(403).json({ error: 'admin_only' });
        return;
    }
    const updated = groups_1.groupStore.removeMember(req.params.id, targetId);
    if (!updated) {
        res.status(404).json({ error: 'member_not_found' });
        return;
    }
    broadcastToGroup(req.params.id, nodeId, 'group_member_removed', { groupId: req.params.id, nodeId: targetId });
    res.json({ status: 'ok', group: updated });
});
// ─── PATCH /:id ───────────────────────────────────────────────────────────────
router.patch('/:id', (req, res) => {
    const nodeId = getNodeId(req);
    if (!nodeId) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const group = groups_1.groupStore.get(req.params.id);
    if (!group) {
        res.status(404).json({ error: 'group_not_found' });
        return;
    }
    if (!group.admins.includes(nodeId)) {
        res.status(403).json({ error: 'admin_only' });
        return;
    }
    const { name, avatar, announcement } = req.body;
    const updated = groups_1.groupStore.update(req.params.id, { name, avatar, announcement });
    broadcastToGroup(req.params.id, nodeId, 'group_updated', { groupId: req.params.id, name, avatar, announcement });
    res.json({ status: 'ok', group: updated });
});
// ─── POST /:id/message ────────────────────────────────────────────────────────
router.post('/:id/message', (req, res) => {
    const nodeId = getNodeId(req);
    if (!nodeId) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const group = groups_1.groupStore.get(req.params.id);
    if (!group) {
        res.status(404).json({ error: 'group_not_found' });
        return;
    }
    if (!group.members.includes(nodeId)) {
        res.status(403).json({ error: 'not_a_member' });
        return;
    }
    // 频道：只有 admins 可以发消息
    if (group.type === 'channel' && !group.admins.includes(nodeId)) {
        res.status(403).json({ error: 'channel_admin_only', message: '频道只有管理员可以发消息' });
        return;
    }
    const { content, replyToId } = req.body;
    if (!content || typeof content !== 'string') {
        res.status(400).json({ error: 'content required' });
        return;
    }
    const msg = groups_1.groupStore.addMessage({ groupId: req.params.id, from: nodeId, content, replyToId });
    // 广播给所有成员
    broadcastToGroup(req.params.id, nodeId, 'group_message', {
        id: msg.id,
        groupId: msg.groupId,
        groupName: group.name,
        groupType: group.type,
        from: msg.from,
        content: msg.content,
        replyToId: msg.replyToId,
        ts: msg.ts,
    });
    res.status(201).json({ status: 'ok', message: msg });
});
// ─── GET /:id/messages ────────────────────────────────────────────────────────
router.get('/:id/messages', (req, res) => {
    const nodeId = getNodeId(req);
    if (!nodeId) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const group = groups_1.groupStore.get(req.params.id);
    if (!group) {
        res.status(404).json({ error: 'group_not_found' });
        return;
    }
    if (!group.members.includes(nodeId)) {
        res.status(403).json({ error: 'not_a_member' });
        return;
    }
    const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 200);
    const before = req.query.before ? parseInt(req.query.before, 10) : undefined;
    const messages = groups_1.groupStore.getMessages(req.params.id, limit, before);
    res.json({ messages, count: messages.length });
});
// ─── POST /:id/pin ────────────────────────────────────────────────────────────
router.post('/:id/pin', (req, res) => {
    const nodeId = getNodeId(req);
    if (!nodeId) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const group = groups_1.groupStore.get(req.params.id);
    if (!group) {
        res.status(404).json({ error: 'group_not_found' });
        return;
    }
    if (!group.admins.includes(nodeId)) {
        res.status(403).json({ error: 'admin_only' });
        return;
    }
    const { messageId } = req.body;
    if (!messageId) {
        res.status(400).json({ error: 'messageId required' });
        return;
    }
    const updated = groups_1.groupStore.pinMessage(req.params.id, messageId);
    if (!updated) {
        res.status(404).json({ error: 'group_not_found' });
        return;
    }
    broadcastToGroup(req.params.id, nodeId, 'group_message_pinned', { groupId: req.params.id, messageId });
    res.json({ status: 'ok', pinnedMessageIds: updated.pinnedMessageIds });
});
exports.default = router;
//# sourceMappingURL=groups.js.map