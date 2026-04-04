/**
 * Hub ClawChat 路由
 *
 * POST /chat/send     — 发送消息（Hub 中转或推送）
 * GET  /chat/inbox    — 拉取离线消息
 * GET  /chat/threads  — 获取会话列表
 * GET  /chat/thread/:id — 获取会话历史
 * POST /chat/thread   — 创建会话
 * WS   /chat/ws       — WebSocket 实时推送
 */

import { Router, Request, Response } from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import { IncomingMessage } from 'http'
import { ChatStore } from '../store/chat'
import type { ChatMessage, ChatGroup } from '../store/chat'
import { isHumanTarget, getHuman, pushToHuman, registerHuman, listHumans } from '../store/human-registry'

const router = Router()
const store = new ChatStore()

// WebSocket 连接池：nodeId → ws
const wsClients = new Map<string, WebSocket>()

// 连接上限
const WS_MAX_CONNECTIONS = 1000

// 心跳追踪：nodeId → isAlive
const wsAlive = new Map<string, boolean>()

// 全局心跳定时器（30s interval）
const HEARTBEAT_INTERVAL = 30_000

setInterval(() => {
  for (const [nodeId, ws] of wsClients) {
    if (!wsAlive.get(nodeId)) {
      // 上次 ping 没收到 pong，强制断开
      console.log(`[chat-ws] ${nodeId} heartbeat timeout, closing`)
      ws.terminate()
      wsClients.delete(nodeId)
      wsAlive.delete(nodeId)
      continue
    }
    wsAlive.set(nodeId, false)
    ws.ping()
  }
}, HEARTBEAT_INTERVAL)

/**
 * 人→人消息路由核心逻辑
 *
 * 优先级：
 * 1. human 有 agentNodeId → 通过 Agent 中转（WebSocket / 离线队列）
 *    消息携带 metadata.humanTarget，Agent 负责最终推送到 human webhookUrl
 * 2. human 仅有 webhookUrl → 直接 webhook 推送（兜底）
 */
function deliverToHuman(target: string, msg: ChatMessage): void {
  const human = getHuman(target)
  if (!human) return

  if (human.agentNodeId) {
    const agentPayload: ChatMessage = {
      ...msg,
      to: human.agentNodeId,
      metadata: {
        ...msg.metadata,
        humanTarget: human.humanId,
        humanDisplayName: human.displayName,
      },
    }
    const agentWs = wsClients.get(human.agentNodeId)
    if (agentWs && agentWs.readyState === WebSocket.OPEN) {
      agentWs.send(JSON.stringify({ event: 'message', data: agentPayload }))
    } else {
      store.queueForOffline(human.agentNodeId, agentPayload)
    }
  } else {
    // 无 Agent，直接 webhook（兜底）
    pushToHuman(human, { from: msg.from, content: msg.content, type: msg.type, id: msg.id })
      .catch(() => {})
  }
}

// ─── REST 路由 ────────────────────────────────────────────────────────────────

// 发送消息
router.post('/send', (req: Request, res: Response) => {
  const msg = req.body as ChatMessage

  if (!msg?.id || !msg?.from || !msg?.to || !msg?.content) {
    res.status(400).json({ error: 'Invalid message format' })
    return
  }

  store.saveMessage(msg)

  // 如果 to 是群组 ID，展开为成员列表（排除发送方自己）
  const toId = Array.isArray(msg.to) ? msg.to[0] : msg.to
  const group = store.getGroup(toId)
  const targets = group
    ? group.members.filter(m => m !== msg.from)
    : (Array.isArray(msg.to) ? msg.to : [msg.to])

  const delivered: string[] = []
  const queued: string[] = []

  for (const target of targets) {
    const payload = group
      ? { ...msg, groupId: group.groupId, groupName: group.name }
      : msg

    // Human 账号：优先走 agentNodeId 中转，无 Agent 则直接 webhook
    if (isHumanTarget(target)) {
      deliverToHuman(target, payload as ChatMessage)
      delivered.push(target)
      continue
    }

    // Agent Node：WebSocket
    const ws = wsClients.get(target)
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: 'message', data: payload }))
      delivered.push(target)
    } else {
      store.queueForOffline(target, payload as ChatMessage)
      queued.push(target)
    }
  }

  res.json({ status: 'ok', messageId: msg.id, delivered, queued })
})

// 拉取离线消息（Node 上线时调用）
router.get('/inbox', (req: Request, res: Response) => {
  const nodeId = req.query.nodeId as string
  if (!nodeId) {
    res.status(400).json({ error: 'nodeId required' })
    return
  }
  const msgs = store.drainInbox(nodeId)
  res.json({ messages: msgs, count: msgs.length })
})

// 会话列表
router.get('/threads', (req: Request, res: Response) => {
  const nodeId = req.query.nodeId as string
  if (!nodeId) {
    res.status(400).json({ error: 'nodeId required' })
    return
  }
  res.json({ threads: store.listThreads(nodeId) })
})

// 会话历史
router.get('/thread/:id', (req: Request, res: Response) => {
  const messages = store.getThread(req.params.id)
  res.json({ messages })
})

// 创建会话
router.post('/thread', (req: Request, res: Response) => {
  const { participants, title } = req.body
  if (!Array.isArray(participants) || participants.length < 2) {
    res.status(400).json({ error: 'participants must be array of 2+ nodeIds' })
    return
  }
  const thread = store.createThread(participants, title)
  res.json({ thread })
})

// 创建群组
router.post('/group/create', (req: Request, res: Response) => {
  const { name, members, topic } = req.body
  const nodeId = req.query.nodeId as string | undefined
  const createdBy = (req.body.createdBy ?? nodeId) as string | undefined
  if (!name || !Array.isArray(members) || members.length < 2 || !createdBy) {
    res.status(400).json({ error: 'name, members (2+), and createdBy required' })
    return
  }
  const group = store.createGroup(name, members, createdBy, topic)
  res.json({ group })
})

// 列出我参与的群组
router.get('/groups', (req: Request, res: Response) => {
  const nodeId = req.query.nodeId as string
  if (!nodeId) {
    res.status(400).json({ error: 'nodeId required' })
    return
  }
  res.json({ groups: store.listGroups(nodeId) })
})

// POST /chat/human/register — 注册人类账号（humanId + webhookUrl）
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

export { router as chatRouter }

/**
 * 向指定 nodeId 的 WebSocket 推送事件（供 social 路由复用）
 * 如果 node 离线，返回 false，调用方负责入队
 */
export function pushToNodeWs(nodeId: string, event: string, data: unknown): boolean {
  const ws = wsClients.get(nodeId)
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event, data }))
    return true
  }
  return false
}

/**
 * 获取指定 nodeId 的 WebSocket 连接（social 路由离线队列用）
 */
export function getNodeWs(nodeId: string): import('ws').WebSocket | undefined {
  return wsClients.get(nodeId)
}

// ─── WebSocket 服务 ───────────────────────────────────────────────────────────

export function attachChatWss(server: import('http').Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/chat/ws' })

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    const nodeId = url.searchParams.get('nodeId')

    if (!nodeId) {
      ws.close(4001, 'nodeId required')
      return
    }

    // 连接数限制：超过上限返回 503
    if (wsClients.size >= WS_MAX_CONNECTIONS) {
      console.warn(`[chat-ws] Connection limit reached (${WS_MAX_CONNECTIONS}), rejecting ${nodeId}`)
      ws.close(4503, 'Service Unavailable: connection limit reached')
      return
    }

    // 注册连接，初始化心跳状态
    wsClients.set(nodeId, ws)
    wsAlive.set(nodeId, true)
    console.log(`[chat-ws] ${nodeId} connected (total: ${wsClients.size})`)

    // pong 回来时标记存活
    ws.on('pong', () => {
      wsAlive.set(nodeId, true)
    })

    // 上线立即推送离线消息（逐条以 message 事件推送）
    const pending = store.drainInbox(nodeId)
    for (const offlineMsg of pending) {
      ws.send(JSON.stringify({ event: 'message', data: offlineMsg }))
    }

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as ChatMessage
        store.saveMessage(msg)

        // 查询是否是群组消息
        const toId = Array.isArray(msg.to) ? msg.to[0] : msg.to
        const group = store.getGroup(toId)

        // 确定实际投递目标（群组展开成员，个人保持原逻辑）
        const targets = group
          ? group.members.filter(m => m !== msg.from)
          : (Array.isArray(msg.to) ? msg.to : [msg.to])

        for (const target of targets) {
          const payload = group
            ? { ...msg, groupId: group.groupId, groupName: group.name }
            : msg

          // Human 账号：优先走 agentNodeId 中转，无 Agent 则直接 webhook
          if (isHumanTarget(target)) {
            setImmediate(() => deliverToHuman(target, payload as ChatMessage))
            continue
          }

          // Agent Node：走 WebSocket
          const targetWs = wsClients.get(target)
          if (targetWs && targetWs.readyState === WebSocket.OPEN) {
            targetWs.send(JSON.stringify({ event: 'message', data: payload }))
          } else {
            store.queueForOffline(target, payload as ChatMessage)
          }
        }

        // task 消息：自动触发 TaskPlanner 规划并回传发送方
        if (msg.type === 'task') {
          setImmediate(async () => {
            try {
              const planResp = await fetch('http://localhost:3100/api/plan/estimate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  taskId: msg.id,
                  title: msg.content.slice(0, 80),
                  description: msg.content,
                  useAi: false,
                })
              })
              const { plan, formatted } = await planResp.json() as { plan: unknown; formatted?: string }
              const planMsg: ChatMessage = {
                id: `plan-${msg.id}`,
                from: 'hub-planner',
                to: msg.from,
                content: formatted ?? JSON.stringify(plan),
                type: 'plan-result',
                ts: Date.now(),
                signature: '',
                encrypted: false,
                metadata: { plan }
              }
              const senderWs = wsClients.get(msg.from)
              if (senderWs?.readyState === WebSocket.OPEN) {
                senderWs.send(JSON.stringify({ event: 'message', data: planMsg }))
              } else {
                store.queueForOffline(msg.from, planMsg)
              }
            } catch (_e) { /* 规划失败不影响消息路由 */ }
          })
        }

        // 静默更新 Owner Memory（type='human' 消息，后台观察，不阻塞）
        if (msg.type === 'human') {
          setImmediate(() => {
            store.observeMessage(msg.from, {
              content: msg.content,
              direction: 'incoming',
              type: msg.type,
            })
          })
        }

        // ACK
        ws.send(JSON.stringify({ event: 'ack', messageId: msg.id }))
      } catch (e) {
        ws.send(JSON.stringify({ event: 'error', message: 'Invalid message format' }))
      }
    })

    ws.on('close', () => {
      wsClients.delete(nodeId)
      wsAlive.delete(nodeId)
      console.log(`[chat-ws] ${nodeId} disconnected (total: ${wsClients.size})`)
    })
  })

  return wss
}
