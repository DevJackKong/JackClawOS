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
 * GET  /api/social/drain/:nodeId  — Node 上线后拉取离线 social 消息
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
import { presenceManager } from '../presence'
import { offlineQueue } from '../store/offline-queue'
import { directoryStore } from '../store/directory'
import { normalizeAgentAddress, parseHandle } from '@jackclaw/protocol'
import { queueWebhookEvent } from './webhooks'

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

function getAuthedAgentHandle(req: Request): string | null {
  const handle = req.jwtPayload?.role === 'user' && typeof req.jwtPayload.nodeId !== 'string'
    ? (req.jwtPayload as { handle?: string }).handle
    : null
  if (!handle) return null
  return typeof handle === 'string' && handle.startsWith('@') ? handle : `@${handle}`
}

function getRequestedAgentHandle(req: Request): string | null {
  const fromQuery = req.query.agentHandle
  if (typeof fromQuery !== 'string' || !fromQuery.trim()) return null
  return fromQuery.trim()
}

function requireAuthorizedAgentHandle(req: Request, res: Response): string | null {
  const authedHandle = getAuthedAgentHandle(req)
  const requestedHandle = getRequestedAgentHandle(req)

  if (!authedHandle) {
    if (!requestedHandle) {
      res.status(400).json({ error: 'agentHandle required' })
      return null
    }
    return requestedHandle
  }

  if (requestedHandle && requestedHandle !== authedHandle) {
    res.status(403).json({ error: 'forbidden', message: 'Cannot access another handle social data' })
    return null
  }

  return authedHandle
}

function requireAuthorizedFromAgent(req: Request, res: Response, fromAgent?: string): string | null {
  const authedHandle = getAuthedAgentHandle(req)
  if (!authedHandle) {
    if (!fromAgent) {
      res.status(400).json({ error: 'fromAgent required' })
      return null
    }
    return fromAgent
  }

  if (!fromAgent) return authedHandle
  if (fromAgent !== authedHandle) {
    res.status(403).json({ error: 'forbidden', message: 'Cannot impersonate another handle' })
    return null
  }
  return authedHandle
}

// ─── Storage (contacts, requests, profiles remain file-backed) ─────────────────

const HUB_DIR               = path.join(process.env.HOME || '~', '.jackclaw', 'hub')
const SOCIAL_CONTACTS_FILE  = path.join(HUB_DIR, 'social-contacts.json')
const SOCIAL_REQUESTS_FILE  = path.join(HUB_DIR, 'social-requests.json')
const SOCIAL_PROFILES_FILE  = path.join(HUB_DIR, 'social-profiles.json')

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

let contacts: Record<string, string[]>       = loadJSON(SOCIAL_CONTACTS_FILE, {})
let requests: Record<string, ContactRequest> = loadJSON(SOCIAL_REQUESTS_FILE, {})
let profiles: Record<string, SocialProfile>  = loadJSON(SOCIAL_PROFILES_FILE, {})

// ─── SocialMessage ↔ StoredMessage adapters ────────────────────────────────────

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

// ─── Thread helper ─────────────────────────────────────────────────────────────

function getOrCreateThread(a: string, b: string): string {
  const key    = [a, b].sort().join('↔')
  const recent = messageStore.getMessagesByParticipant(a, 10, 0)
  const existing = recent.find(m =>
    m.threadId &&
    ((m.fromAgent === a && m.toAgent === b) || (m.fromAgent === b && m.toAgent === a)),
  )
  if (existing?.threadId) return existing.threadId
  return `thread-${key}-${Date.now()}`
}

// ─── Deliver helper ────────────────────────────────────────────────────────────

/**
 * Attempt to deliver a social message to the target agent.
 *
 * Flow:
 *   1. resolveHandle(toAgent) — get nodeId + online/wsConnected flags
 *   2. If wsConnected → push via WebSocket
 *   3. If offline → enqueue in unified offline-queue (keyed by @handle)
 *      + trigger Web Push notification
 */
function deliverSocialMsg(msg: SocialMessage): void {
  const { nodeId, wsConnected } = presenceManager.resolveHandle(msg.toAgent)

  // Normalize the target handle for consistent queue keying
  const parsed = parseHandle(msg.toAgent)
  const queueHandle = parsed ? `@${parsed.local}` : msg.toAgent

  queueWebhookEvent(msg.toAgent, 'message', {
    id: msg.id,
    fromAgent: msg.fromAgent,
    toAgent: msg.toAgent,
    content: msg.content,
    type: msg.type,
    ts: msg.ts,
  })

  if (!nodeId) {
    // Agent not registered — queue by handle; will be drained when they register+connect
    offlineQueue.enqueue(queueHandle, { event: 'social', data: msg })
    return
  }

  if (wsConnected) {
    const sent = pushToNodeWs(nodeId, 'social', msg)
    if (sent) return
  }

  // Node offline (or WS push failed) — queue by handle for reliable delivery
  offlineQueue.enqueue(queueHandle, { event: 'social', data: msg })

  // Best-effort Web Push notification
  setImmediate(() => {
    void pushService.push(nodeId, {
      title: `Social message from ${msg.fromAgent}`,
      body:  msg.content.slice(0, 120),
      data:  { type: 'social', messageId: msg.id, from: msg.fromAgent },
    })
  })
}

/**
 * Deliver a SocialMessage that arrived from a remote hub via federation.
 * Exported so routes/federation.ts can call it without circular imports at load time.
 */
export function deliverFederatedMessage(msg: SocialMessage): void {
  try { messageStore.saveMessage(socialToStored(msg)) } catch { /* best-effort */ }
  deliverSocialMsg(msg)
  console.log(`[social/fed] Federated delivery: ${msg.fromAgent} → ${msg.toAgent}`)
}

// ─── POST /send ────────────────────────────────────────────────────────────────

router.post('/send', async (req: Request, res: Response) => {
  const body = req.body as Partial<SocialMessage>
  const fromAgent = requireAuthorizedFromAgent(req, res, body.fromAgent)
  if (!fromAgent) return

  if (!body.toAgent || !body.content) {
    return res.status(400).json({ error: 'missing_fields', required: ['toAgent', 'content'] })
  }

  // M2: validate message type whitelist
  const ALLOWED_MSG_TYPES = ['text', 'business', 'task']
  if (body.type && !ALLOWED_MSG_TYPES.includes(body.type)) {
    return res.status(400).json({ error: 'invalid_message_type', message: `Unsupported type "${body.type}". Allowed: ${ALLOWED_MSG_TYPES.join(', ')}` })
  }

  const fromHuman = typeof body.fromHuman === 'string' && body.fromHuman.trim().length > 0
    ? body.fromHuman
    : fromAgent.replace(/^@/, '')

  // Resolve target profile using both original and canonical forms
  const targetProfile = profiles[body.toAgent] ?? profiles[normalizeAgentAddress(body.toAgent)]
  if (targetProfile?.contactPolicy === 'closed') {
    return res.status(403).json({ error: 'contact_policy_closed', message: `${body.toAgent} does not accept external messages` })
  }
  if (targetProfile?.contactPolicy === 'request') {
    const myContacts = contacts[fromAgent] ?? []
    if (!myContacts.includes(body.toAgent)) {
      return res.status(403).json({ error: 'contact_required', message: `Contact request required — send a contact request first` })
    }
  }

  const msgUserId = fromAgent
  const msgQuota  = quotaManager.checkQuota(msgUserId, 'maxMessagePerDay')
  if (!msgQuota.allowed) {
    return res.status(429).json({
      error:     'quota_exceeded',
      message:   `Daily message quota exceeded (${msgQuota.limit}/day), remaining: 0`,
      remaining: 0,
    })
  }

  const thread = body.thread ?? getOrCreateThread(fromAgent, body.toAgent)

  const msg: SocialMessage = {
    id:        body.id ?? crypto.randomUUID(),
    fromHuman,
    fromAgent,
    toAgent:   body.toAgent,
    toHuman:   body.toHuman,
    content:   body.content,
    type:      body.type ?? 'text',
    replyTo:   body.replyTo,
    thread,
    ts:        Date.now(),
    encrypted: body.encrypted ?? false,
    signature: body.signature ?? '',
  }

  // Check if target is local
  const { nodeId: localNodeId } = presenceManager.resolveHandle(msg.toAgent)

  if (!localNodeId) {
    const fedMgr = getFedMgr()
    if (fedMgr) {
      try {
        const result = await fedMgr.routeToRemoteHub(msg.toAgent, msg)
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
  }

  try { messageStore.saveMessage(socialToStored(msg)) } catch { /* best-effort */ }

  deliverSocialMsg(msg)
  quotaManager.incrementUsage(msgUserId, 'maxMessagePerDay')

  console.log(`[social] ${msg.fromAgent} → ${msg.toAgent}: ${msg.content.slice(0, 50)}`)
  return res.status(201).json({ status: 'ok', messageId: msg.id, thread })
})

// ─── POST /contact ─────────────────────────────────────────────────────────────

router.post('/contact', (req: Request, res: Response) => {
  const body = req.body as Partial<ContactRequest>
  const fromAgent = requireAuthorizedFromAgent(req, res, body.fromAgent)
  if (!fromAgent) return

  if (!body.toAgent || !body.message) {
    return res.status(400).json({ error: 'missing_fields', required: ['toAgent', 'message'] })
  }

  const myContacts = contacts[fromAgent] ?? contacts[normalizeAgentAddress(fromAgent)] ?? []
  const toKey = body.toAgent
  if (myContacts.includes(toKey) || myContacts.includes(normalizeAgentAddress(toKey))) {
    return res.status(409).json({ error: 'already_contacts', message: 'Already contacts' })
  }

  const req2: ContactRequest = {
    id:       crypto.randomUUID(),
    fromAgent,
    toAgent:   body.toAgent,
    message:   body.message,
    purpose:   body.purpose ?? 'Establish contact',
    status:    'pending',
    ts:        Date.now(),
  }

  requests[req2.id] = req2
  saveJSON(SOCIAL_REQUESTS_FILE, requests)

  queueWebhookEvent(req2.toAgent, 'contact_request', req2)

  // Notify target via WS or queue
  const { nodeId: toNodeId, wsConnected } = presenceManager.resolveHandle(body.toAgent)
  if (toNodeId && wsConnected) {
    pushToNodeWs(toNodeId, 'social_contact_request', req2)
  } else {
    offlineQueue.enqueue(body.toAgent, { event: 'social_contact_request', data: req2 })
  }

  console.log(`[social] Contact request: ${req2.fromAgent} → ${req2.toAgent}`)
  return res.status(201).json({ status: 'ok', requestId: req2.id, request: req2 })
})

// ─── POST /contact/respond ─────────────────────────────────────────────────────

router.post('/contact/respond', (req: Request, res: Response) => {
  const body = req.body as ContactResponse
  const fromAgent = requireAuthorizedFromAgent(req, res, body.fromAgent)
  if (!fromAgent) return

  if (!body.requestId || !body.decision) {
    return res.status(400).json({ error: 'missing_fields', required: ['requestId', 'decision'] })
  }

  const cr = requests[body.requestId]
  if (!cr) return res.status(404).json({ error: 'request_not_found' })
  if (cr.toAgent !== fromAgent) return res.status(403).json({ error: 'not_your_request' })

  cr.status = body.decision === 'accept' ? 'accepted' : 'declined'
  requests[body.requestId] = cr
  saveJSON(SOCIAL_REQUESTS_FILE, requests)

  if (body.decision === 'accept') {
    const aContacts = contacts[cr.fromAgent] ?? []
    const bContacts = contacts[cr.toAgent] ?? []
    if (!aContacts.includes(cr.toAgent)) aContacts.push(cr.toAgent)
    if (!bContacts.includes(cr.fromAgent)) bContacts.push(cr.fromAgent)
    contacts[cr.fromAgent] = aContacts
    contacts[cr.toAgent]   = bContacts
    saveJSON(SOCIAL_CONTACTS_FILE, contacts)
  }

  // Notify requester via WS or queue
  const responsePayload = { requestId: body.requestId, decision: body.decision, message: body.message }
  queueWebhookEvent(cr.fromAgent, 'contact_response', responsePayload)
  const { nodeId: fromNodeId, wsConnected } = presenceManager.resolveHandle(cr.fromAgent)
  if (fromNodeId && wsConnected) {
    pushToNodeWs(fromNodeId, 'social_contact_response', responsePayload)
  } else if (cr.fromAgent) {
    offlineQueue.enqueue(cr.fromAgent, { event: 'social_contact_response', data: responsePayload })
  }

  console.log(`[social] Contact response: ${cr.toAgent} ${body.decision} request from ${cr.fromAgent}`)
  return res.json({ status: 'ok', requestId: body.requestId, decision: body.decision })
})

// ─── GET /contacts ─────────────────────────────────────────────────────────────

router.get('/contacts', (req: Request, res: Response) => {
  const agentHandle = requireAuthorizedAgentHandle(req, res)
  if (!agentHandle) return

  const list     = contacts[agentHandle] ?? []
  const enriched = list.map(h => ({ handle: h, profile: profiles[h] ?? null }))
  return res.json({ contacts: enriched, count: list.length })
})

// ─── GET /messages ─────────────────────────────────────────────────────────────

router.get('/messages', (req: Request, res: Response) => {
  const agentHandle = requireAuthorizedAgentHandle(req, res)
  if (!agentHandle) return

  const { limit: limitStr, offset: offsetStr } = req.query as Record<string, string>
  const limit  = parseInt(limitStr  ?? '20', 10)
  const offset = parseInt(offsetStr ?? '0',  10)

  const stored = messageStore.getInbox(agentHandle, limit, offset)
  const inbox  = stored.map(storedToSocial)

  return res.json({ messages: inbox, count: inbox.length })
})

// ─── POST /profile ─────────────────────────────────────────────────────────────

router.post('/profile', (req: Request, res: Response) => {
  const body = req.body as Partial<SocialProfile>
  const agentHandle = requireAuthorizedFromAgent(req, res, body.agentHandle)
  if (!agentHandle) return

  const existing = profiles[agentHandle] ?? {}
  const profile: SocialProfile = {
    agentHandle,
    ownerName:     body.ownerName     ?? (existing as any).ownerName     ?? '',
    ownerTitle:    body.ownerTitle    ?? (existing as any).ownerTitle    ?? '',
    bio:           body.bio           ?? (existing as any).bio           ?? '',
    skills:        body.skills        ?? (existing as any).skills        ?? [],
    contactPolicy: body.contactPolicy ?? (existing as any).contactPolicy ?? 'request',
    hubUrl:        body.hubUrl        ?? (existing as any).hubUrl        ?? `http://localhost:${process.env.HUB_PORT ?? 3100}`,
    updatedAt:     Date.now(),
  }

  profiles[agentHandle] = profile
  saveJSON(SOCIAL_PROFILES_FILE, profiles)

  console.log(`[social] Profile updated: ${agentHandle}`)
  return res.json({ status: 'ok', profile })
})

// ─── GET /profile/:handle ─────────────────────────────────────────────────────

router.get('/profile/:handle', (req: Request, res: Response) => {
  const handle  = decodeURIComponent(req.params.handle)
  const profile = profiles[handle] ?? null
  if (!profile) return res.status(404).json({ error: 'profile_not_found', handle })
  return res.json({ profile })
})

// ─── POST /reply ───────────────────────────────────────────────────────────────

router.post('/reply', (req: Request, res: Response) => {
  const { replyToId, fromHuman, fromAgent: requestedFromAgent, content, type } = req.body as {
    replyToId: string
    fromHuman: string
    fromAgent: string
    content:   string
    type?:     SocialMessage['type']
  }

  const fromAgent = requireAuthorizedFromAgent(req, res, requestedFromAgent)
  if (!fromAgent) return

  if (!replyToId || !content) {
    return res.status(400).json({ error: 'missing_fields', required: ['replyToId', 'content'] })
  }

  const original = messageStore.getMessage(replyToId)
  if (!original) return res.status(404).json({ error: 'original_message_not_found' })

  const toAgent = original.fromAgent === fromAgent ? original.toAgent : original.fromAgent

  const msg: SocialMessage = {
    id:        crypto.randomUUID(),
    fromHuman: fromHuman || fromAgent.replace(/^@/, ''),
    fromAgent,
    toAgent,
    content,
    type:      type ?? 'text',
    replyTo:   replyToId,
    thread:    original.threadId,
    ts:        Date.now(),
    encrypted: false,
    signature: '',
  }

  try { messageStore.saveMessage(socialToStored(msg)) } catch { /* best-effort */ }
  deliverSocialMsg(msg)

  console.log(`[social] Reply: ${fromAgent} → ${toAgent} (replyTo: ${replyToId})`)
  return res.status(201).json({ status: 'ok', messageId: msg.id })
})

// ─── GET /threads ──────────────────────────────────────────────────────────────

router.get('/threads', (req: Request, res: Response) => {
  const agentHandle = requireAuthorizedAgentHandle(req, res)
  if (!agentHandle) return

  const stored = messageStore.getMessagesByParticipant(agentHandle, 1000, 0)
  const myMsgs = stored.map(storedToSocial)

  const threadMap = new Map<string, SocialThread>()
  for (const m of myMsgs) {
    const tid      = m.thread ?? `direct-${[m.fromAgent, m.toAgent].sort().join('↔')}`
    const existing = threadMap.get(tid)
    const other    = m.fromAgent === agentHandle ? m.toAgent : m.fromAgent

    if (!existing) {
      threadMap.set(tid, {
        id:            tid,
        participants:  [agentHandle, other],
        lastMessage:   m.content.slice(0, 80),
        lastMessageAt: m.ts,
        messageCount:  1,
      })
    } else {
      existing.messageCount++
      if (m.ts > existing.lastMessageAt) {
        existing.lastMessageAt = m.ts
        existing.lastMessage   = m.content.slice(0, 80)
      }
    }
  }

  const threads = [...threadMap.values()].sort((a, b) => b.lastMessageAt - a.lastMessageAt)
  return res.json({ threads, count: threads.length })
})

// ─── GET /thread/:id — 获取指定会话的完整消息历史 ────────────────────────────────

router.get('/thread/:id', (req: Request, res: Response) => {
  const threadId = decodeURIComponent(req.params.id)
  const limit    = Math.min(parseInt((req.query.limit as string) ?? '200', 10), 500)

  const stored   = messageStore.getThread(threadId, limit, 0)
  const messages = stored.map(storedToSocial)

  return res.json({ messages, count: messages.length })
})

// ─── GET /drain/:nodeId — Node 上线后拉取离线 social 消息 ─────────────────────

router.get('/drain/:nodeId', (req: Request, res: Response) => {
  const { nodeId } = req.params
  // Drain the unified offline queue for all @handles of this node
  const handles  = directoryStore.getHandlesForNode(nodeId)
  const messages: unknown[] = []
  for (const handle of handles) {
    for (const envelope of offlineQueue.dequeue(handle)) {
      messages.push(envelope.data)
    }
  }
  return res.json({ messages, count: messages.length })
})

export default router
