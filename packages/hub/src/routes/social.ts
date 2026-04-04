/**
 * Hub Social Communication Routes
 *
 * POST /api/social/send           — 发社交消息
 * POST /api/social/contact        — 发联系请求
 * POST /api/social/contact/respond — 回复联系请求
 * GET  /api/social/contacts       — 查联系人列表  ?agentHandle=@alice
 * GET  /api/social/messages       — 收件箱       ?agentHandle=@alice&limit=20&offset=0
 * POST /api/social/profile        — 设置名片
 * GET  /api/social/profile/:handle — 查看名片
 * POST /api/social/reply          — 回复消息（自动找原消息 fromAgent）
 * GET  /api/social/threads        — 查看会话列表  ?agentHandle=@alice
 */

import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type {
  SocialMessage,
  ContactRequest,
  ContactResponse,
  SocialProfile,
  SocialThread,
} from '@jackclaw/protocol'
import { pushToNodeWs } from './chat'
import { pushService } from '../push-service'
import { messageStore } from '../store/message-store'
import type { StoredMessage } from '../store/message-store'
import { quotaManager } from '../quota'

// Lazy import to avoid circular dependencies at module load time
function getFedMgr() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getFederationManager } = require('../federation') as typeof import('../federation')
    return getFederationManager()
  } catch {
    return null
  }
}

const router = Router()

// ─── Storage ──────────────────────────────────────────────────────────────────

const HUB_DIR = path.join(process.env.HOME || '~', '.jackclaw', 'hub')
const SOCIAL_CONTACTS_FILE  = path.join(HUB_DIR, 'social-contacts.json')
const SOCIAL_REQUESTS_FILE  = path.join(HUB_DIR, 'social-requests.json')
const SOCIAL_PROFILES_FILE  = path.join(HUB_DIR, 'social-profiles.json')
const SOCIAL_QUEUE_FILE     = path.join(HUB_DIR, 'social-queue.json')

function loadJSON<T>(file: string, def: T): T {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8')) as T
  } catch { /* ignore */ }
  return def
}

function saveJSON(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
}

// In-memory caches (contacts, requests, profiles remain file-backed; messages → SQLite)
let contacts:  Record<string, string[]>                = loadJSON(SOCIAL_CONTACTS_FILE, {})  // handle → handle[]
let requests:  Record<string, ContactRequest>          = loadJSON(SOCIAL_REQUESTS_FILE, {})
let profiles:  Record<string, SocialProfile>           = loadJSON(SOCIAL_PROFILES_FILE, {})
// 离线队列：agentHandle → SocialMessage[]（目标 node 离线时暂存）
let offlineQueue: Record<string, SocialMessage[]>      = loadJSON(SOCIAL_QUEUE_FILE, {})

// ─── SocialMessage ↔ StoredMessage adapters ───────────────────────────────────

function socialToStored(msg: SocialMessage): StoredMessage {
  return {
    id:        msg.id,
    threadId:  msg.thread,
    fromAgent: msg.fromAgent,
    toAgent:   msg.toAgent,
    fromHuman: msg.fromHuman,
    content:   msg.content,
    type:      msg.type,
    replyTo:   msg.replyTo,
    status:    'sent',
    ts:        msg.ts,
    encrypted: msg.encrypted,
  }
}

function storedToSocial(s: StoredMessage): SocialMessage {
  return {
    id:        s.id,
    fromHuman: s.fromHuman ?? '',
    fromAgent: s.fromAgent,
    toAgent:   s.toAgent,
    content:   s.content,
    type:      s.type as SocialMessage['type'],
    replyTo:   s.replyTo,
    thread:    s.threadId,
    ts:        s.ts,
    encrypted: s.encrypted,
    signature: '',
  }
}

// ─── Directory lookup helper ──────────────────────────────────────────────────

// 读 directory.json 获取 nodeId
function lookupNodeId(handle: string): string | null {
  const dirFile = path.join(HUB_DIR, 'directory.json')
  const dir = loadJSON<Record<string, { nodeId: string }>>(dirFile, {})
  const key = handle.startsWith('@') ? handle : `@${handle}`
  return dir[key]?.nodeId ?? null
}

// ─── Thread helper ────────────────────────────────────────────────────────────

function getOrCreateThread(a: string, b: string): string {
  const key = [a, b].sort().join('↔')
  // Check messageStore for an existing thread between these two participants
  const recent = messageStore.getMessagesByParticipant(a, 10, 0)
  const existing = recent.find(m =>
    m.threadId &&
    ((m.fromAgent === a && m.toAgent === b) || (m.fromAgent === b && m.toAgent === a)),
  )
  if (existing?.threadId) return existing.threadId
  return `thread-${key}-${Date.now()}`
}

// ─── Deliver helper ───────────────────────────────────────────────────────────

function deliverSocialMsg(msg: SocialMessage): void {
  const nodeId = lookupNodeId(msg.toAgent)
  if (!nodeId) {
    // 目标未注册，加入离线队列（handle 级）
    const q = offlineQueue[msg.toAgent] ?? []
    q.push(msg)
    offlineQueue[msg.toAgent] = q
    saveJSON(SOCIAL_QUEUE_FILE, offlineQueue)
    return
  }

  const sent = pushToNodeWs(nodeId, 'social', msg)
  if (!sent) {
    // node 离线，加入离线队列（nodeId 级，node 重连后通过 /api/social/drain 拉取）
    const q = offlineQueue[nodeId] ?? []
    q.push(msg)
    offlineQueue[nodeId] = q
    saveJSON(SOCIAL_QUEUE_FILE, offlineQueue)
    // Also notify via Web Push if node has a browser subscription
    setImmediate(() => {
      void pushService.push(nodeId, {
        title: `Social message from ${msg.fromAgent}`,
        body: msg.content.slice(0, 120),
        data: { type: 'social', messageId: msg.id, from: msg.fromAgent },
      })
    })
  }
}

/**
 * Deliver a SocialMessage that arrived from a remote hub via federation.
 * Exported so routes/federation.ts can call it without circular imports at load time.
 */
export function deliverFederatedMessage(msg: SocialMessage): void {
  // Persist to MessageStore first
  try { messageStore.saveMessage(socialToStored(msg)) } catch { /* best-effort */ }
  // Then attempt local WebSocket delivery / offline queue
  deliverSocialMsg(msg)
  console.log(`[social/fed] Federated delivery: ${msg.fromAgent} → ${msg.toAgent}`)
}

// ─── POST /send ───────────────────────────────────────────────────────────────

router.post('/send', async (req: Request, res: Response) => {
  const body = req.body as Partial<SocialMessage>

  if (!body.fromHuman || !body.fromAgent || !body.toAgent || !body.content) {
    return res.status(400).json({ error: 'missing_fields', required: ['fromHuman', 'fromAgent', 'toAgent', 'content'] })
  }

  // 检查目标 Agent 的联系策略
  const targetProfile = profiles[body.toAgent]
  if (targetProfile?.contactPolicy === 'closed') {
    return res.status(403).json({ error: 'contact_policy_closed', message: `${body.toAgent} 不接受外来消息` })
  }
  if (targetProfile?.contactPolicy === 'request') {
    // 检查是否已建立联系
    const myContacts = contacts[body.fromAgent] ?? []
    if (!myContacts.includes(body.toAgent)) {
      return res.status(403).json({ error: 'contact_required', message: `需先发送联系请求并被接受` })
    }
  }

  // ── Quota check: messages per day ─────────────────────────────────────────
  const msgUserId = body.fromAgent
  const msgQuota  = quotaManager.checkQuota(msgUserId, 'maxMessagePerDay')
  if (!msgQuota.allowed) {
    return res.status(429).json({
      error: 'quota_exceeded',
      message: `每日消息上限已达到 (${msgQuota.limit} 条/天)，剩余: 0`,
      remaining: 0,
    })
  }
  // ── End quota check ────────────────────────────────────────────────────────

  const thread = body.thread ?? getOrCreateThread(body.fromAgent, body.toAgent)

  const msg: SocialMessage = {
    id: body.id ?? crypto.randomUUID(),
    fromHuman: body.fromHuman,
    fromAgent: body.fromAgent,
    toAgent: body.toAgent,
    toHuman: body.toHuman,
    content: body.content,
    type: body.type ?? 'text',
    replyTo: body.replyTo,
    thread,
    ts: Date.now(),
    encrypted: body.encrypted ?? false,
    signature: body.signature ?? '',
  }

  // Check if the target agent is local
  const localNodeId = lookupNodeId(msg.toAgent)

  if (!localNodeId) {
    // ── Federation routing ──────────────────────────────────────────────────
    const fedMgr = getFedMgr()
    if (fedMgr) {
      try {
        const result = await fedMgr.routeToRemoteHub(msg.toAgent, msg)
        // Also persist locally so sender has a record
        try { messageStore.saveMessage(socialToStored(msg)) } catch { /* best-effort */ }
        quotaManager.incrementUsage(msgUserId, 'maxMessagePerDay')
        console.log(`[social] ${msg.fromAgent} → ${msg.toAgent} (federated): ${msg.content.slice(0, 50)}`)
        return res.status(201).json({ status: 'ok', messageId: msg.id, thread, routed: 'federation', federationResult: result })
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        if (errMsg.startsWith('agent_not_found')) {
          return res.status(404).json({ error: 'agent_not_found', message: `${msg.toAgent} is not registered on this hub or any federated hub` })
        }
        console.error('[social] Federation routing error:', errMsg)
        return res.status(502).json({ error: 'federation_error', message: errMsg })
      }
    }
    // No federation manager — fall through to offline queue
  }

  try { messageStore.saveMessage(socialToStored(msg)) } catch { /* best-effort */ }

  deliverSocialMsg(msg)
  quotaManager.incrementUsage(msgUserId, 'maxMessagePerDay')

  console.log(`[social] ${msg.fromAgent} → ${msg.toAgent}: ${msg.content.slice(0, 50)}`)
  return res.status(201).json({ status: 'ok', messageId: msg.id, thread })
})

// ─── POST /contact ────────────────────────────────────────────────────────────

router.post('/contact', (req: Request, res: Response) => {
  const body = req.body as Partial<ContactRequest>

  if (!body.fromAgent || !body.toAgent || !body.message) {
    return res.status(400).json({ error: 'missing_fields', required: ['fromAgent', 'toAgent', 'message'] })
  }

  // 检查是否已经是联系人
  const myContacts = contacts[body.fromAgent] ?? []
  if (myContacts.includes(body.toAgent)) {
    return res.status(409).json({ error: 'already_contacts', message: '你们已经是联系人' })
  }

  const req2: ContactRequest = {
    id: crypto.randomUUID(),
    fromAgent: body.fromAgent,
    toAgent: body.toAgent,
    message: body.message,
    purpose: body.purpose ?? '建立联系',
    status: 'pending',
    ts: Date.now(),
  }

  requests[req2.id] = req2
  saveJSON(SOCIAL_REQUESTS_FILE, requests)

  // 通知目标 Agent
  const toNodeId = lookupNodeId(body.toAgent)
  if (toNodeId) {
    const sent = pushToNodeWs(toNodeId, 'social_contact_request', req2)
    if (!sent) {
      const q = offlineQueue[toNodeId] ?? []
      q.push({ ...req2, type: 'request', content: req2.message } as unknown as SocialMessage)
      offlineQueue[toNodeId] = q
      saveJSON(SOCIAL_QUEUE_FILE, offlineQueue)
    }
  }

  console.log(`[social] Contact request: ${req2.fromAgent} → ${req2.toAgent}`)
  return res.status(201).json({ status: 'ok', requestId: req2.id, request: req2 })
})

// ─── POST /contact/respond ────────────────────────────────────────────────────

router.post('/contact/respond', (req: Request, res: Response) => {
  const body = req.body as ContactResponse

  if (!body.requestId || !body.fromAgent || !body.decision) {
    return res.status(400).json({ error: 'missing_fields', required: ['requestId', 'fromAgent', 'decision'] })
  }

  const cr = requests[body.requestId]
  if (!cr) return res.status(404).json({ error: 'request_not_found' })
  if (cr.toAgent !== body.fromAgent) return res.status(403).json({ error: 'not_your_request' })

  cr.status = body.decision === 'accept' ? 'accepted' : 'declined'
  requests[body.requestId] = cr
  saveJSON(SOCIAL_REQUESTS_FILE, requests)

  if (body.decision === 'accept') {
    // 双向加入联系人
    const aContacts = contacts[cr.fromAgent] ?? []
    const bContacts = contacts[cr.toAgent] ?? []
    if (!aContacts.includes(cr.toAgent)) aContacts.push(cr.toAgent)
    if (!bContacts.includes(cr.fromAgent)) bContacts.push(cr.fromAgent)
    contacts[cr.fromAgent] = aContacts
    contacts[cr.toAgent] = bContacts
    saveJSON(SOCIAL_CONTACTS_FILE, contacts)
  }

  // 通知发起方
  const fromNodeId = lookupNodeId(cr.fromAgent)
  if (fromNodeId) {
    pushToNodeWs(fromNodeId, 'social_contact_response', { requestId: body.requestId, decision: body.decision, message: body.message })
  }

  console.log(`[social] Contact response: ${cr.toAgent} ${body.decision} request from ${cr.fromAgent}`)
  return res.json({ status: 'ok', requestId: body.requestId, decision: body.decision })
})

// ─── GET /contacts ────────────────────────────────────────────────────────────

router.get('/contacts', (req: Request, res: Response) => {
  const { agentHandle } = req.query as { agentHandle?: string }
  if (!agentHandle) return res.status(400).json({ error: 'agentHandle required' })

  const list = contacts[agentHandle] ?? []
  const enriched = list.map(h => ({ handle: h, profile: profiles[h] ?? null }))
  return res.json({ contacts: enriched, count: list.length })
})

// ─── GET /messages ────────────────────────────────────────────────────────────

router.get('/messages', (req: Request, res: Response) => {
  const { agentHandle, limit: limitStr, offset: offsetStr } = req.query as Record<string, string>
  if (!agentHandle) return res.status(400).json({ error: 'agentHandle required' })

  const limit  = parseInt(limitStr  ?? '20', 10)
  const offset = parseInt(offsetStr ?? '0',  10)

  const stored = messageStore.getInbox(agentHandle, limit, offset)
  const inbox  = stored.map(storedToSocial)

  return res.json({ messages: inbox, count: inbox.length })
})

// ─── POST /profile ────────────────────────────────────────────────────────────

router.post('/profile', (req: Request, res: Response) => {
  const body = req.body as Partial<SocialProfile>

  if (!body.agentHandle) {
    return res.status(400).json({ error: 'agentHandle required' })
  }

  const existing = profiles[body.agentHandle] ?? {}
  const profile: SocialProfile = {
    agentHandle:   body.agentHandle,
    ownerName:     body.ownerName     ?? (existing as any).ownerName     ?? '',
    ownerTitle:    body.ownerTitle    ?? (existing as any).ownerTitle    ?? '',
    bio:           body.bio           ?? (existing as any).bio           ?? '',
    skills:        body.skills        ?? (existing as any).skills        ?? [],
    contactPolicy: body.contactPolicy ?? (existing as any).contactPolicy ?? 'request',
    hubUrl:        body.hubUrl        ?? (existing as any).hubUrl        ?? `http://localhost:${process.env.HUB_PORT ?? 3100}`,
    updatedAt:     Date.now(),
  }

  profiles[body.agentHandle] = profile
  saveJSON(SOCIAL_PROFILES_FILE, profiles)

  console.log(`[social] Profile updated: ${body.agentHandle}`)
  return res.json({ status: 'ok', profile })
})

// ─── GET /profile/:handle ─────────────────────────────────────────────────────

router.get('/profile/:handle', (req: Request, res: Response) => {
  const handle = decodeURIComponent(req.params.handle)
  const profile = profiles[handle] ?? null
  if (!profile) return res.status(404).json({ error: 'profile_not_found', handle })
  return res.json({ profile })
})

// ─── POST /reply ──────────────────────────────────────────────────────────────

router.post('/reply', (req: Request, res: Response) => {
  const { replyToId, fromHuman, fromAgent, content, type } = req.body as {
    replyToId: string
    fromHuman: string
    fromAgent: string
    content: string
    type?: SocialMessage['type']
  }

  if (!replyToId || !fromHuman || !fromAgent || !content) {
    return res.status(400).json({ error: 'missing_fields', required: ['replyToId', 'fromHuman', 'fromAgent', 'content'] })
  }

  const original = messageStore.getMessage(replyToId)
  if (!original) return res.status(404).json({ error: 'original_message_not_found' })

  // 目标：原消息的发送方（如果我是原消息的 toAgent，那我在回复发送方）
  const toAgent = original.fromAgent === fromAgent ? original.toAgent : original.fromAgent

  const msg: SocialMessage = {
    id: crypto.randomUUID(),
    fromHuman,
    fromAgent,
    toAgent,
    content,
    type: type ?? 'text',
    replyTo: replyToId,
    thread: original.threadId,
    ts: Date.now(),
    encrypted: false,
    signature: '',
  }

  try { messageStore.saveMessage(socialToStored(msg)) } catch { /* best-effort */ }

  deliverSocialMsg(msg)

  console.log(`[social] Reply: ${fromAgent} → ${toAgent} (replyTo: ${replyToId})`)
  return res.status(201).json({ status: 'ok', messageId: msg.id })
})

// ─── GET /threads ─────────────────────────────────────────────────────────────

router.get('/threads', (req: Request, res: Response) => {
  const { agentHandle } = req.query as { agentHandle?: string }
  if (!agentHandle) return res.status(400).json({ error: 'agentHandle required' })

  // 找出所有涉及该 agent 的消息
  const stored = messageStore.getMessagesByParticipant(agentHandle, 1000, 0)
  const myMsgs = stored.map(storedToSocial)

  // 按 thread 分组
  const threadMap = new Map<string, SocialThread>()
  for (const m of myMsgs) {
    const tid = m.thread ?? `direct-${[m.fromAgent, m.toAgent].sort().join('↔')}`
    const existing = threadMap.get(tid)
    const other = m.fromAgent === agentHandle ? m.toAgent : m.fromAgent

    if (!existing) {
      threadMap.set(tid, {
        id: tid,
        participants: [agentHandle, other],
        lastMessage: m.content.slice(0, 80),
        lastMessageAt: m.ts,
        messageCount: 1,
      })
    } else {
      existing.messageCount++
      if (m.ts > existing.lastMessageAt) {
        existing.lastMessageAt = m.ts
        existing.lastMessage = m.content.slice(0, 80)
      }
    }
  }

  const threads = [...threadMap.values()].sort((a, b) => b.lastMessageAt - a.lastMessageAt)
  return res.json({ threads, count: threads.length })
})

// ─── GET /drain/:nodeId — Node 上线后拉取离线 social 消息 ─────────────────────

router.get('/drain/:nodeId', (req: Request, res: Response) => {
  const { nodeId } = req.params
  const pending = offlineQueue[nodeId] ?? []
  delete offlineQueue[nodeId]
  saveJSON(SOCIAL_QUEUE_FILE, offlineQueue)
  return res.json({ messages: pending, count: pending.length })
})

export default router
