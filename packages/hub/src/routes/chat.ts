/**
 * Hub ClawChat 路由
 *
 * POST /chat/send          — 发送消息（Hub 中转或推送）
 * GET  /chat/inbox         — 拉取离线消息
 * GET  /chat/threads       — 获取会话列表
 * GET  /chat/thread/:id    — 获取会话历史
 * POST /chat/thread        — 创建会话
 * POST /chat/group/create  — 创建群组
 * GET  /chat/groups        — 列出我参与的群组
 * POST /chat/human/register — 注册人类账号
 * GET  /chat/humans        — 列出所有人类账号
 * WS   /chat/ws            — WebSocket 实时推送
 *
 * 所有消息处理委托给 ChatWorker；路由只做参数校验。
 */

import { Router, Request, Response } from 'express'
import type { JwtPayload } from 'jsonwebtoken'
import type { WebSocketServer } from 'ws'
import type { ChatMessage } from '../store/chat'
import { registerHuman, listHumans } from '../store/human-registry'
import { chatWorker } from '../chat-worker'
import { offlineQueue } from '../store/offline-queue'

const router = Router()


function getRequesterId(req: Request): string | null {
  const payload = req.jwtPayload as (JwtPayload & { nodeId?: string; handle?: string; sub?: string }) | undefined
  return payload?.nodeId ?? payload?.handle ?? payload?.sub ?? null
}

function getRecallTargets(msg: ChatMessage): string[] {
  const directTargets = Array.isArray(msg.to) ? msg.to : [msg.to]
  const group = directTargets.length === 1 ? chatWorker.store.getGroup(directTargets[0]) : null
  const participants = group
    ? [msg.from, ...group.members.filter(member => member !== msg.from)]
    : [msg.from, ...directTargets]
  return [...new Set(participants)]
}

// ─── REST 路由 ────────────────────────────────────────────────────────────────

// 发送消息
router.post('/send', (req: Request, res: Response) => {
  const msg = req.body as ChatMessage

  if (!msg?.id || !msg?.from || !msg?.to || !msg?.content) {
    res.status(400).json({ error: 'Invalid message format' })
    return
  }

  // Delegate to worker — delivery is async, we return immediately
  chatWorker.handleIncoming(msg)

  res.json({ status: 'ok', messageId: msg.id })
})


// 撤回消息
router.delete('/messages/:id', (req: Request, res: Response) => {
  const requesterId = getRequesterId(req)
  if (!requesterId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const messageId = req.params.id
  const msg = chatWorker.store.getMessage(messageId)
  if (!msg) {
    res.status(404).json({ error: 'Message not found' })
    return
  }
  if (msg.from !== requesterId) {
    res.status(403).json({ error: 'Only sender can recall message' })
    return
  }
  if (msg.recalled) {
    res.json({ status: 'ok', message: msg })
    return
  }
  if (Date.now() - msg.ts > 2 * 60 * 1000) {
    res.status(400).json({ error: 'Recall window expired' })
    return
  }

  const recalled = chatWorker.store.recallMessage(messageId, Date.now())
  if (!recalled) {
    res.status(500).json({ error: 'Failed to recall message' })
    return
  }

  const participants = getRecallTargets(recalled)
  for (const participant of participants) {
    chatWorker.pushEvent(participant, 'message_recalled', {
      id: recalled.id,
      threadId: recalled.threadId,
      recalledAt: recalled.recalledAt,
    })
  }

  res.json({ status: 'ok', message: recalled })
})

// 拉取离线消息（Node 上线时调用）
// 合并 chat inbox + social offlineQueue，支持 nodeId 或 handle 查询
router.get('/inbox', (req: Request, res: Response) => {
  const nodeId = req.query.nodeId as string
  if (!nodeId) {
    res.status(400).json({ error: 'nodeId required' })
    return
  }

  // 1. Chat store inbox — 查 nodeId 本身 + 可能的 handle 变体
  const chatMsgs = [
    ...chatWorker.store.drainInbox(nodeId),
    ...chatWorker.store.drainInbox(`user-${nodeId}`),
  ]

  // 2. Social offlineQueue — 查所有 handle 变体
  const handleVariants = [`@${nodeId}`, `@${nodeId}.jackclaw`]
  // 如果 nodeId 以 user- 开头，也查原始 handle
  if (nodeId.startsWith('user-')) {
    const bare = nodeId.slice(5)
    handleVariants.push(`@${bare}`, `@${bare}.jackclaw`)
    chatMsgs.push(...chatWorker.store.drainInbox(bare))
  }

  const socialMsgs: any[] = []
  for (const h of handleVariants) {
    for (const envelope of offlineQueue.dequeue(h)) {
      if (envelope.data) socialMsgs.push(envelope.data)
    }
  }

  const allMsgs = [...chatMsgs, ...socialMsgs]
  res.json({ messages: allMsgs, count: allMsgs.length })
})

// 会话列表
router.get('/threads', (req: Request, res: Response) => {
  const nodeId = req.query.nodeId as string
  if (!nodeId) {
    res.status(400).json({ error: 'nodeId required' })
    return
  }
  res.json({ threads: chatWorker.store.listThreads(nodeId) })
})

// 会话历史
router.get('/thread/:id', (req: Request, res: Response) => {
  res.json({ messages: chatWorker.store.getThread(req.params.id) })
})

// 创建会话
router.post('/thread', (req: Request, res: Response) => {
  const { participants, title } = req.body
  if (!Array.isArray(participants) || participants.length < 2) {
    res.status(400).json({ error: 'participants must be array of 2+ nodeIds' })
    return
  }
  res.json({ thread: chatWorker.store.createThread(participants, title) })
})

// 创建群组
router.post('/group/create', (req: Request, res: Response) => {
  const { name, members, topic } = req.body
  const nodeId    = req.query.nodeId as string | undefined
  const createdBy = (req.body.createdBy ?? nodeId) as string | undefined
  if (!name || !Array.isArray(members) || members.length < 2 || !createdBy) {
    res.status(400).json({ error: 'name, members (2+), and createdBy required' })
    return
  }
  res.json({ group: chatWorker.store.createGroup(name, members, createdBy, topic) })
})

// 列出我参与的群组
router.get('/groups', (req: Request, res: Response) => {
  const nodeId = req.query.nodeId as string
  if (!nodeId) {
    res.status(400).json({ error: 'nodeId required' })
    return
  }
  res.json({ groups: chatWorker.store.listGroups(nodeId) })
})

// 注册人类账号
router.post('/human/register', (req: Request, res: Response) => {
  const { humanId, displayName, agentNodeId, webhookUrl, feishuOpenId } = req.body ?? {}
  if (!humanId || !displayName) {
    res.status(400).json({ error: 'humanId and displayName required' })
    return
  }
  const human = registerHuman({ humanId, displayName, agentNodeId, webhookUrl, feishuOpenId })
  res.json({ status: 'ok', human })
})

router.get('/humans', (_req: Request, res: Response) => {
  res.json({ humans: listHumans() })
})

// Worker stats (diagnostics)
router.get('/stats', (_req: Request, res: Response) => {
  res.json(chatWorker.getStats())
})

export { router as chatRouter }

/**
 * Push an arbitrary event to a connected node's WebSocket.
 * Used by the social route. Returns false if node is offline.
 */
export function pushToNodeWs(nodeId: string, event: string, data: unknown): boolean {
  return chatWorker.pushEvent(nodeId, event, data)
}

/**
 * Raw WebSocket access for social route offline queueing.
 */
export function getNodeWs(nodeId: string): import('ws').WebSocket | undefined {
  return chatWorker.getClientWs(nodeId)
}

// ─── WebSocket 服务 ───────────────────────────────────────────────────────────

export function attachChatWss(server: import('http').Server): WebSocketServer {
  return chatWorker.attachWss(server)
}
