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

import { Router, Request, Response } from 'express'
import { groupStore } from '../store/groups'
import { pushToNodeWs } from './chat'
import { ChatStore } from '../store/chat'
import { quotaManager } from '../quota'

const router = Router()

// 复用 ChatStore 做离线队列（群消息推送）
const chatStore = new ChatStore()

// ─── Helper ───────────────────────────────────────────────────────────────────

/** 从 JWT payload 取 nodeId */
function getNodeId(req: Request): string | null {
  return req.jwtPayload?.nodeId ?? null
}

/** 向群成员推送事件（在线 WS，否则进离线队列） */
function broadcastToGroup(groupId: string, excludeNodeId: string, event: string, data: unknown): void {
  const group = groupStore.get(groupId)
  if (!group) return
  for (const memberId of group.members) {
    if (memberId === excludeNodeId) continue
    const sent = pushToNodeWs(memberId, event, data)
    if (!sent) {
      // 构造最简离线消息入队
      chatStore.queueForOffline(memberId, {
        id: (data as { id?: string }).id ?? `${event}-${Date.now()}`,
        from: excludeNodeId,
        to: memberId,
        type: 'broadcast',
        content: JSON.stringify(data),
        ts: Date.now(),
        signature: '',
        encrypted: false,
        metadata: { groupEvent: event, groupId },
      })
    }
  }
}

// ─── POST /join/:inviteCode (must come before /:id routes) ───────────────────

router.post('/join/:inviteCode', (req: Request, res: Response) => {
  const nodeId = getNodeId(req)
  if (!nodeId) { res.status(401).json({ error: 'unauthorized' }); return }

  const group = groupStore.joinByInvite(req.params.inviteCode, nodeId)
  if (!group) { res.status(404).json({ error: 'invite_code_not_found' }); return }

  broadcastToGroup(group.id, nodeId, 'group_member_joined', { groupId: group.id, nodeId })
  res.json({ status: 'ok', group })
})

// ─── POST /create ─────────────────────────────────────────────────────────────

router.post('/create', (req: Request, res: Response) => {
  const nodeId = getNodeId(req)
  if (!nodeId) { res.status(401).json({ error: 'unauthorized' }); return }

  const { name, members, avatar, type } = req.body as {
    name?: string
    members?: string[]
    avatar?: string
    type?: string
  }

  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'name required' }); return
  }
  if (type && type !== 'group' && type !== 'channel') {
    res.status(400).json({ error: 'type must be group or channel' }); return
  }

  // ── Quota check: maxGroups per node ────────────────────────────────────────
  const existingGroups = groupStore.listForMember(nodeId)
  const createdByNode  = existingGroups.filter(g => g.createdBy === nodeId)
  const groupQuota     = quotaManager.checkQuota(nodeId, 'maxGroups', 1)
  // Sync stored count so the quota reflects reality
  quotaManager.setUsage(nodeId, 'maxGroups', createdByNode.length)
  if (!groupQuota.allowed || createdByNode.length >= groupQuota.limit) {
    res.status(429).json({
      error: 'quota_exceeded',
      message: `已达到群组上限 (${groupQuota.limit})`,
      limit: groupQuota.limit,
      used: createdByNode.length,
    }); return
  }
  // ── End quota check ─────────────────────────────────────────────────────────

  const group = groupStore.create({
    name,
    members: Array.isArray(members) ? members : [],
    createdBy: nodeId,
    avatar,
    type: (type as 'group' | 'channel') ?? 'group',
  })

  console.log(`[groups] Created ${group.type} "${group.name}" by ${nodeId}`)
  res.status(201).json({ status: 'ok', group })
})

// ─── GET /list ────────────────────────────────────────────────────────────────

router.get('/list', (req: Request, res: Response) => {
  const nodeId = getNodeId(req)
  if (!nodeId) { res.status(401).json({ error: 'unauthorized' }); return }

  const groups = groupStore.listForMember(nodeId)
  res.json({ groups, count: groups.length })
})

// ─── GET /:id ─────────────────────────────────────────────────────────────────

router.get('/:id', (req: Request, res: Response) => {
  const nodeId = getNodeId(req)
  if (!nodeId) { res.status(401).json({ error: 'unauthorized' }); return }

  const group = groupStore.get(req.params.id)
  if (!group) { res.status(404).json({ error: 'group_not_found' }); return }
  if (!group.members.includes(nodeId)) {
    res.status(403).json({ error: 'not_a_member' }); return
  }

  res.json({ group })
})

// ─── POST /:id/members ────────────────────────────────────────────────────────

router.post('/:id/members', (req: Request, res: Response) => {
  const nodeId = getNodeId(req)
  if (!nodeId) { res.status(401).json({ error: 'unauthorized' }); return }

  const group = groupStore.get(req.params.id)
  if (!group) { res.status(404).json({ error: 'group_not_found' }); return }
  if (!group.admins.includes(nodeId)) {
    res.status(403).json({ error: 'admin_only' }); return
  }

  const { nodeIds } = req.body as { nodeIds?: string[] }
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
    res.status(400).json({ error: 'nodeIds array required' }); return
  }

  const updated = groupStore.addMembers(req.params.id, nodeIds)!
  broadcastToGroup(req.params.id, nodeId, 'group_members_added', { groupId: req.params.id, nodeIds })
  res.json({ status: 'ok', group: updated })
})

// ─── DELETE /:id/members/:nodeId ──────────────────────────────────────────────

router.delete('/:id/members/:memberId', (req: Request, res: Response) => {
  const nodeId = getNodeId(req)
  if (!nodeId) { res.status(401).json({ error: 'unauthorized' }); return }

  const group = groupStore.get(req.params.id)
  if (!group) { res.status(404).json({ error: 'group_not_found' }); return }

  // 管理员可移除任意成员；普通成员只能退出自己
  const targetId = req.params.memberId
  const isSelf = targetId === nodeId
  if (!isSelf && !group.admins.includes(nodeId)) {
    res.status(403).json({ error: 'admin_only' }); return
  }

  const updated = groupStore.removeMember(req.params.id, targetId)
  if (!updated) { res.status(404).json({ error: 'member_not_found' }); return }

  broadcastToGroup(req.params.id, nodeId, 'group_member_removed', { groupId: req.params.id, nodeId: targetId })
  res.json({ status: 'ok', group: updated })
})

// ─── PATCH /:id ───────────────────────────────────────────────────────────────

router.patch('/:id', (req: Request, res: Response) => {
  const nodeId = getNodeId(req)
  if (!nodeId) { res.status(401).json({ error: 'unauthorized' }); return }

  const group = groupStore.get(req.params.id)
  if (!group) { res.status(404).json({ error: 'group_not_found' }); return }
  if (!group.admins.includes(nodeId)) {
    res.status(403).json({ error: 'admin_only' }); return
  }

  const { name, avatar, announcement } = req.body as {
    name?: string; avatar?: string; announcement?: string
  }

  const updated = groupStore.update(req.params.id, { name, avatar, announcement })!
  broadcastToGroup(req.params.id, nodeId, 'group_updated', { groupId: req.params.id, name, avatar, announcement })
  res.json({ status: 'ok', group: updated })
})

// ─── POST /:id/message ────────────────────────────────────────────────────────

router.post('/:id/message', (req: Request, res: Response) => {
  const nodeId = getNodeId(req)
  if (!nodeId) { res.status(401).json({ error: 'unauthorized' }); return }

  const group = groupStore.get(req.params.id)
  if (!group) { res.status(404).json({ error: 'group_not_found' }); return }
  if (!group.members.includes(nodeId)) {
    res.status(403).json({ error: 'not_a_member' }); return
  }

  // 频道：只有 admins 可以发消息
  if (group.type === 'channel' && !group.admins.includes(nodeId)) {
    res.status(403).json({ error: 'channel_admin_only', message: '频道只有管理员可以发消息' }); return
  }

  const { content, replyToId } = req.body as { content?: string; replyToId?: string }
  if (!content || typeof content !== 'string') {
    res.status(400).json({ error: 'content required' }); return
  }

  const msg = groupStore.addMessage({ groupId: req.params.id, from: nodeId, content, replyToId })

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
  })

  res.status(201).json({ status: 'ok', message: msg })
})

// ─── GET /:id/messages ────────────────────────────────────────────────────────

router.get('/:id/messages', (req: Request, res: Response) => {
  const nodeId = getNodeId(req)
  if (!nodeId) { res.status(401).json({ error: 'unauthorized' }); return }

  const group = groupStore.get(req.params.id)
  if (!group) { res.status(404).json({ error: 'group_not_found' }); return }
  if (!group.members.includes(nodeId)) {
    res.status(403).json({ error: 'not_a_member' }); return
  }

  const limit = Math.min(parseInt(req.query.limit as string ?? '50', 10), 200)
  const before = req.query.before ? parseInt(req.query.before as string, 10) : undefined

  const messages = groupStore.getMessages(req.params.id, limit, before)
  res.json({ messages, count: messages.length })
})

// ─── POST /:id/pin ────────────────────────────────────────────────────────────

router.post('/:id/pin', (req: Request, res: Response) => {
  const nodeId = getNodeId(req)
  if (!nodeId) { res.status(401).json({ error: 'unauthorized' }); return }

  const group = groupStore.get(req.params.id)
  if (!group) { res.status(404).json({ error: 'group_not_found' }); return }
  if (!group.admins.includes(nodeId)) {
    res.status(403).json({ error: 'admin_only' }); return
  }

  const { messageId } = req.body as { messageId?: string }
  if (!messageId) { res.status(400).json({ error: 'messageId required' }); return }

  const updated = groupStore.pinMessage(req.params.id, messageId)
  if (!updated) { res.status(404).json({ error: 'group_not_found' }); return }

  broadcastToGroup(req.params.id, nodeId, 'group_message_pinned', { groupId: req.params.id, messageId })
  res.json({ status: 'ok', pinnedMessageIds: updated.pinnedMessageIds })
})

export default router
