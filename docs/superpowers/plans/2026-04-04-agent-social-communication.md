# Agent Social Communication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable human-to-human messaging via their respective Agents: Human A → Agent A → Hub → Agent B → Human B, with contact requests, profiles, offline queuing, and reply threading.

**Architecture:** Protocol types define the social message envelope; Hub routes handle send/receive/queue via the existing WebSocket client pool and offline queue; Node-side SocialHandler intercepts social-type messages from the chat client and notifies the owner; CLI surfaces the common operations as `jackclaw social <subcommand>`.

**Tech Stack:** TypeScript, Express, existing `ChatStore` + `wsClients` (hub), `NodeChatClient` + `OwnerMemory` (node), `commander` + `chalk` + `axios` (CLI), `@jackclaw/protocol` (shared types).

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `packages/protocol/src/social.ts` | All social protocol types (SocialMessage, ContactRequest, ContactResponse, SocialProfile) |
| Modify | `packages/protocol/src/index.ts` | Export `* from './social'` |
| Create | `packages/hub/src/store/social.ts` | Persistent social store: messages, contacts, profiles, offline queues |
| Create | `packages/hub/src/routes/social.ts` | All `/api/social/*` REST handlers |
| Modify | `packages/hub/src/server.ts` | Mount `socialRoute` at `/api/social` (JWT-protected) |
| Create | `packages/node/src/social-handler.ts` | Intercept social messages from chat client → notify owner |
| Modify | `packages/node/src/index.ts` | Instantiate `SocialHandler` and wire it to `chatClient` |
| Create | `packages/cli/src/commands/social.ts` | `jackclaw social` subcommands |
| Modify | `packages/cli/src/index.ts` | Register social command |

---

## Task 1: Protocol Types — `packages/protocol/src/social.ts`

**Files:**
- Create: `packages/protocol/src/social.ts`
- Modify: `packages/protocol/src/index.ts`

- [ ] **Step 1: Create social.ts**

```typescript
// packages/protocol/src/social.ts
// Agent Social Communication Protocol Types

export type SocialMessageType = 'text' | 'request' | 'introduction' | 'business'

export interface SocialMessage {
  id: string
  fromHuman: string          // sending human's humanId
  fromAgent: string          // sending agent's @handle
  toAgent: string            // receiving agent's @handle (full, e.g. "@bob.jackclaw")
  toHuman?: string           // receiving human's humanId (filled by receiver's agent)
  content: string
  type: SocialMessageType
  replyTo?: string           // messageId of the message being replied to
  thread?: string            // conversation thread ID
  ts: number
  // routing metadata (not encrypted, used by Hub only)
  _routing?: {
    fromNodeId: string       // sender's nodeId for reply routing
    delivered?: boolean
    deliveredAt?: number
  }
}

export interface ContactRequest {
  id: string
  fromAgent: string          // @handle
  toAgent: string            // @handle
  fromHuman: string          // human display name or ID
  message: string            // self-introduction
  purpose: string            // reason for contacting
  ts: number
  status: 'pending' | 'accepted' | 'declined'
  respondedAt?: number
}

export interface ContactResponse {
  requestId: string
  fromAgent: string          // the responder's @handle
  toAgent: string            // the original requester's @handle
  accepted: boolean
  note?: string              // optional message from responder
  ts: number
}

export type ContactPolicy = 'open' | 'request-only' | 'closed'

export interface SocialProfile {
  agentHandle: string        // @handle
  ownerName: string          // public name (not ID)
  ownerTitle?: string        // e.g. "Founder, Acme Corp"
  bio?: string
  skills?: string[]
  contactPolicy: ContactPolicy
  updatedAt: number
}
```

- [ ] **Step 2: Export from protocol index**

In `packages/protocol/src/index.ts`, add at the end:
```typescript
export * from './social'
```

- [ ] **Step 3: Build protocol to verify types compile**

```bash
cd packages/protocol && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
cd /Users/jack/Documents/mack/orgclaw
git add packages/protocol/src/social.ts packages/protocol/src/index.ts
git commit -m "feat: social protocol types (SocialMessage, ContactRequest, SocialProfile)"
```

---

## Task 2: Hub Social Store — `packages/hub/src/store/social.ts`

**Files:**
- Create: `packages/hub/src/store/social.ts`

- [ ] **Step 1: Create the store**

```typescript
// packages/hub/src/store/social.ts
// Social Store — persists social messages, contact requests, profiles, offline queues

import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import type { SocialMessage, ContactRequest, SocialProfile } from '@jackclaw/protocol'

const HUB_DIR = path.join(process.env.HOME || '~', '.jackclaw', 'hub')
const SOCIAL_FILE = path.join(HUB_DIR, 'social.json')

interface SocialData {
  messages: SocialMessage[]
  contacts: ContactRequest[]
  profiles: Record<string, SocialProfile>  // handle → profile
}

function load(): SocialData {
  try {
    if (fs.existsSync(SOCIAL_FILE)) {
      return JSON.parse(fs.readFileSync(SOCIAL_FILE, 'utf-8')) as SocialData
    }
  } catch { /* ignore */ }
  return { messages: [], contacts: [], profiles: {} }
}

function save(data: SocialData): void {
  fs.mkdirSync(path.dirname(SOCIAL_FILE), { recursive: true })
  fs.writeFileSync(SOCIAL_FILE, JSON.stringify(data, null, 2), 'utf-8')
}

// ─── Message store ─────────────────────────────────────────────────────────

export function saveMessage(msg: SocialMessage): void {
  const data = load()
  data.messages.push(msg)
  // Keep last 10 000 messages
  if (data.messages.length > 10_000) data.messages = data.messages.slice(-10_000)
  save(data)
}

export function getMessagesForAgent(handle: string, limit = 100): SocialMessage[] {
  const data = load()
  return data.messages
    .filter(m => m.toAgent === handle || m.fromAgent === handle)
    .slice(-limit)
}

export function getThread(threadId: string): SocialMessage[] {
  const data = load()
  return data.messages.filter(m => m.thread === threadId)
}

export function getThreads(handle: string): string[] {
  const data = load()
  const threads = new Set<string>()
  for (const m of data.messages) {
    if ((m.toAgent === handle || m.fromAgent === handle) && m.thread) {
      threads.add(m.thread)
    }
  }
  return [...threads]
}

export function getMessageById(id: string): SocialMessage | undefined {
  return load().messages.find(m => m.id === id)
}

// ─── Contact requests ──────────────────────────────────────────────────────

export function saveContactRequest(req: ContactRequest): void {
  const data = load()
  const idx = data.contacts.findIndex(c => c.id === req.id)
  if (idx >= 0) { data.contacts[idx] = req } else { data.contacts.push(req) }
  save(data)
}

export function getPendingContacts(handle: string): ContactRequest[] {
  return load().contacts.filter(c => c.toAgent === handle && c.status === 'pending')
}

export function getContactById(id: string): ContactRequest | undefined {
  return load().contacts.find(c => c.id === id)
}

export function getContacts(handle: string): ContactRequest[] {
  return load().contacts.filter(
    c => (c.fromAgent === handle || c.toAgent === handle) && c.status === 'accepted'
  )
}

// ─── Social profiles ───────────────────────────────────────────────────────

export function setProfile(profile: SocialProfile): void {
  const data = load()
  data.profiles[profile.agentHandle] = profile
  save(data)
}

export function getProfile(handle: string): SocialProfile | undefined {
  return load().profiles[handle]
}
```

- [ ] **Step 2: Build hub to verify no import errors**

```bash
cd packages/hub && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
cd /Users/jack/Documents/mack/orgclaw
git add packages/hub/src/store/social.ts
git commit -m "feat: hub social store (messages, contacts, profiles)"
```

---

## Task 3: Hub Social Routes — `packages/hub/src/routes/social.ts`

**Files:**
- Create: `packages/hub/src/routes/social.ts`
- Modify: `packages/hub/src/server.ts`

- [ ] **Step 1: Create social routes file**

```typescript
// packages/hub/src/routes/social.ts
/**
 * /api/social — Agent Social Communication
 *
 * POST /api/social/send        — send a social message (Human A → Agent A → Agent B → Human B)
 * POST /api/social/contact     — send a contact request
 * POST /api/social/contact/respond — accept/decline a contact request
 * GET  /api/social/contacts    — list accepted contacts for calling agent
 * GET  /api/social/messages    — inbox for calling agent
 * POST /api/social/profile     — create/update social profile
 * GET  /api/social/profile/:handle — view another agent's profile
 * POST /api/social/reply       — reply to a social message (shorthand: sets replyTo + thread)
 * GET  /api/social/threads     — list conversation threads for calling agent
 */

import { Router, Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { WebSocket } from 'ws'
import {
  SocialMessage,
  ContactRequest,
  ContactResponse,
  SocialProfile,
  parseHandle,
} from '@jackclaw/protocol'
import {
  saveMessage,
  getMessagesForAgent,
  getThread,
  getThreads,
  getMessageById,
  saveContactRequest,
  getPendingContacts,
  getContactById,
  getContacts,
  setProfile,
  getProfile,
} from '../store/social'
import { getDirectoryEntry } from '../store/directory-helpers'

// wsClients is managed by chat.ts — import the map so we can push to online agents
import { getWsClient } from '../routes/chat'

const router = Router()

// ─── POST /api/social/send ────────────────────────────────────────────────

router.post('/send', (req: Request, res: Response) => {
  const { fromHuman, fromAgent, toAgent, content, type = 'text', replyTo, thread } = req.body ?? {}
  if (!fromHuman || !fromAgent || !toAgent || !content) {
    res.status(400).json({ error: 'fromHuman, fromAgent, toAgent, content required' })
    return
  }

  const parsedTo = parseHandle(toAgent)
  if (!parsedTo) {
    res.status(400).json({ error: 'invalid toAgent handle' })
    return
  }

  // Look up the receiving agent's nodeId in the directory
  const receiverProfile = getDirectoryEntry(parsedTo.full)
  if (!receiverProfile) {
    res.status(404).json({ error: `Agent ${parsedTo.full} not found in directory` })
    return
  }

  const msg: SocialMessage = {
    id: randomUUID(),
    fromHuman,
    fromAgent,
    toAgent: parsedTo.full,
    content,
    type: type as SocialMessage['type'],
    ts: Date.now(),
    ...(replyTo && { replyTo }),
    thread: thread ?? randomUUID(),  // new thread if not in existing one
    _routing: { fromNodeId: receiverProfile.nodeId ?? '', delivered: false },
  }

  saveMessage(msg)

  // Deliver to receiving agent: WebSocket (online) or offline queue
  const ws = getWsClient(receiverProfile.nodeId ?? '')
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event: 'social', data: msg }))
    msg._routing!.delivered = true
    msg._routing!.deliveredAt = Date.now()
    saveMessage(msg)  // update with delivery info
  }
  // (offline delivery happens when agent reconnects and pulls /chat/inbox —
  //  or via a separate social inbox endpoint; social messages are stored persistently)

  res.json({ status: 'ok', messageId: msg.id, thread: msg.thread, delivered: msg._routing!.delivered })
})

// ─── POST /api/social/contact ─────────────────────────────────────────────

router.post('/contact', (req: Request, res: Response) => {
  const { fromAgent, toAgent, fromHuman, message, purpose } = req.body ?? {}
  if (!fromAgent || !toAgent || !fromHuman || !message || !purpose) {
    res.status(400).json({ error: 'fromAgent, toAgent, fromHuman, message, purpose required' })
    return
  }

  const parsedTo = parseHandle(toAgent)
  if (!parsedTo) {
    res.status(400).json({ error: 'invalid toAgent handle' })
    return
  }

  const contact: ContactRequest = {
    id: randomUUID(),
    fromAgent,
    toAgent: parsedTo.full,
    fromHuman,
    message,
    purpose,
    ts: Date.now(),
    status: 'pending',
  }

  saveContactRequest(contact)

  // Notify receiving agent if online
  const receiverProfile = getDirectoryEntry(parsedTo.full)
  if (receiverProfile) {
    const ws = getWsClient(receiverProfile.nodeId ?? '')
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: 'social-contact-request', data: contact }))
    }
  }

  res.json({ status: 'ok', requestId: contact.id })
})

// ─── POST /api/social/contact/respond ────────────────────────────────────

router.post('/contact/respond', (req: Request, res: Response) => {
  const { requestId, fromAgent, accepted, note } = req.body ?? {}
  if (!requestId || fromAgent === undefined || accepted === undefined) {
    res.status(400).json({ error: 'requestId, fromAgent, accepted required' })
    return
  }

  const existing = getContactById(requestId)
  if (!existing) {
    res.status(404).json({ error: 'Contact request not found' })
    return
  }

  existing.status = accepted ? 'accepted' : 'declined'
  existing.respondedAt = Date.now()
  saveContactRequest(existing)

  // Notify the original requester about the response
  const requesterProfile = getDirectoryEntry(existing.fromAgent)
  if (requesterProfile) {
    const response: ContactResponse = {
      requestId,
      fromAgent,
      toAgent: existing.fromAgent,
      accepted,
      note,
      ts: Date.now(),
    }
    const ws = getWsClient(requesterProfile.nodeId ?? '')
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: 'social-contact-response', data: response }))
    }
  }

  res.json({ status: 'ok', accepted })
})

// ─── GET /api/social/contacts ─────────────────────────────────────────────

router.get('/contacts', (req: Request, res: Response) => {
  const handle = req.query.handle as string
  if (!handle) {
    res.status(400).json({ error: 'handle query param required' })
    return
  }
  const parsed = parseHandle(handle)
  if (!parsed) {
    res.status(400).json({ error: 'invalid handle' })
    return
  }
  const contacts = getContacts(parsed.full)
  res.json({ contacts })
})

// ─── GET /api/social/messages ─────────────────────────────────────────────

router.get('/messages', (req: Request, res: Response) => {
  const handle = req.query.handle as string
  if (!handle) {
    res.status(400).json({ error: 'handle query param required' })
    return
  }
  const parsed = parseHandle(handle)
  if (!parsed) {
    res.status(400).json({ error: 'invalid handle' })
    return
  }
  const limit = parseInt(req.query.limit as string ?? '50', 10)
  const messages = getMessagesForAgent(parsed.full, limit)
  const pending = getPendingContacts(parsed.full)
  res.json({ messages, pendingContacts: pending })
})

// ─── POST /api/social/profile ─────────────────────────────────────────────

router.post('/profile', (req: Request, res: Response) => {
  const { agentHandle, ownerName, ownerTitle, bio, skills, contactPolicy } = req.body ?? {}
  if (!agentHandle || !ownerName || !contactPolicy) {
    res.status(400).json({ error: 'agentHandle, ownerName, contactPolicy required' })
    return
  }
  const parsed = parseHandle(agentHandle)
  if (!parsed) {
    res.status(400).json({ error: 'invalid agentHandle' })
    return
  }

  const profile: SocialProfile = {
    agentHandle: parsed.full,
    ownerName,
    ownerTitle,
    bio,
    skills,
    contactPolicy: contactPolicy as SocialProfile['contactPolicy'],
    updatedAt: Date.now(),
  }
  setProfile(profile)
  res.json({ status: 'ok', profile })
})

// ─── GET /api/social/profile/:handle ─────────────────────────────────────

router.get('/profile/:handle', (req: Request, res: Response) => {
  const raw = decodeURIComponent(req.params.handle)
  const parsed = parseHandle(raw)
  if (!parsed) {
    res.status(400).json({ error: 'invalid handle' })
    return
  }
  const profile = getProfile(parsed.full)
  if (!profile) {
    res.status(404).json({ error: 'Profile not found' })
    return
  }
  res.json({ profile })
})

// ─── POST /api/social/reply ───────────────────────────────────────────────

router.post('/reply', (req: Request, res: Response) => {
  const { replyTo, fromHuman, fromAgent, content, type = 'text' } = req.body ?? {}
  if (!replyTo || !fromHuman || !fromAgent || !content) {
    res.status(400).json({ error: 'replyTo, fromHuman, fromAgent, content required' })
    return
  }

  const original = getMessageById(replyTo)
  if (!original) {
    res.status(404).json({ error: 'Original message not found' })
    return
  }

  // Reply goes back to the original sender's agent
  req.body.toAgent = original.fromAgent
  req.body.thread = original.thread
  req.body.replyTo = replyTo

  // Re-use the send handler logic inline
  const toAgent = original.fromAgent
  const parsedTo = parseHandle(toAgent)
  if (!parsedTo) {
    res.status(400).json({ error: 'invalid original sender handle' })
    return
  }

  const receiverProfile = getDirectoryEntry(parsedTo.full)

  const msg: SocialMessage = {
    id: randomUUID(),
    fromHuman,
    fromAgent,
    toAgent: parsedTo.full,
    content,
    type: type as SocialMessage['type'],
    replyTo,
    thread: original.thread,
    ts: Date.now(),
    _routing: { fromNodeId: receiverProfile?.nodeId ?? '', delivered: false },
  }

  saveMessage(msg)

  if (receiverProfile) {
    const ws = getWsClient(receiverProfile.nodeId ?? '')
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: 'social', data: msg }))
      msg._routing!.delivered = true
      msg._routing!.deliveredAt = Date.now()
      saveMessage(msg)
    }
  }

  res.json({ status: 'ok', messageId: msg.id, thread: msg.thread, delivered: msg._routing!.delivered })
})

// ─── GET /api/social/threads ──────────────────────────────────────────────

router.get('/threads', (req: Request, res: Response) => {
  const handle = req.query.handle as string
  if (!handle) {
    res.status(400).json({ error: 'handle query param required' })
    return
  }
  const parsed = parseHandle(handle)
  if (!parsed) {
    res.status(400).json({ error: 'invalid handle' })
    return
  }
  const threadIds = getThreads(parsed.full)
  // For each thread, return the last message as preview
  const threads = threadIds.map(id => {
    const msgs = getThread(id)
    const last = msgs[msgs.length - 1]
    return { threadId: id, messageCount: msgs.length, lastMessage: last }
  })
  res.json({ threads })
})

export default router
```

- [ ] **Step 2: Add `getWsClient` export to chat.ts**

In `packages/hub/src/routes/chat.ts`, find the `wsClients` map declaration and add an export function after it:

```typescript
// Add after: const wsClients = new Map<string, WebSocket>()
export function getWsClient(nodeId: string): WebSocket | undefined {
  return wsClients.get(nodeId)
}
```

- [ ] **Step 3: Add `getDirectoryEntry` helper to hub store**

Create `packages/hub/src/store/directory-helpers.ts`:

```typescript
// packages/hub/src/store/directory-helpers.ts
// Thin helper to read directory store without circular imports

import fs from 'fs'
import path from 'path'
import type { AgentProfile } from '@jackclaw/protocol'

const HUB_DIR = path.join(process.env.HOME || '~', '.jackclaw', 'hub')
const DIRECTORY_FILE = path.join(HUB_DIR, 'directory.json')

export function getDirectoryEntry(handle: string): AgentProfile | undefined {
  try {
    if (!fs.existsSync(DIRECTORY_FILE)) return undefined
    const dir = JSON.parse(fs.readFileSync(DIRECTORY_FILE, 'utf-8')) as Record<string, AgentProfile>
    return dir[handle]
  } catch {
    return undefined
  }
}
```

- [ ] **Step 4: Mount route in server.ts**

In `packages/hub/src/server.ts`, add the import after the other route imports:
```typescript
import socialRoute from './routes/social'
```

Then inside `createServer()`, add after the `askRoute` line:
```typescript
  app.use('/api/social', socialRoute)
```

- [ ] **Step 5: Build hub**

```bash
cd packages/hub && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
cd /Users/jack/Documents/mack/orgclaw
git add packages/hub/src/store/social.ts packages/hub/src/store/directory-helpers.ts \
  packages/hub/src/routes/social.ts packages/hub/src/routes/chat.ts \
  packages/hub/src/server.ts
git commit -m "feat: hub /api/social routes + social store + getWsClient export"
```

---

## Task 4: Node Social Handler — `packages/node/src/social-handler.ts`

**Files:**
- Create: `packages/node/src/social-handler.ts`
- Modify: `packages/node/src/index.ts`

- [ ] **Step 1: Create social-handler.ts**

```typescript
// packages/node/src/social-handler.ts
/**
 * SocialHandler — Node-side interceptor for social messages
 *
 * When the Agent receives a `social` or `social-contact-request` event
 * from Hub (via NodeChatClient WebSocket), it:
 *   1. Identifies the sender and message content
 *   2. Notifies the owner through their preferred channel (webhookUrl / log)
 *   3. Records the contact in owner memory
 *   4. When the owner replies, forwards the reply back through Hub
 */

import axios from 'axios'
import { OwnerMemory } from './owner-memory'
import type { SocialMessage, ContactRequest } from '@jackclaw/protocol'
import type { NodeConfig } from './config'
import type { NodeIdentity } from '@jackclaw/protocol'

export class SocialHandler {
  private ownerMemory: OwnerMemory

  constructor(
    private identity: NodeIdentity,
    private config: NodeConfig,
    ownerMemory: OwnerMemory,
  ) {
    this.ownerMemory = ownerMemory
  }

  /**
   * Handle an incoming social message (event: 'social')
   * Called by the chat client message handler when type routing detects a social event.
   */
  async onSocialMessage(msg: SocialMessage): Promise<void> {
    console.log(`[social] Message from ${msg.fromAgent} (${msg.fromHuman}): ${msg.content.substring(0, 80)}`)

    // Record new contact in owner memory if not already known
    this.ownerMemory.add({
      type: 'relationship',
      content: `Social contact: ${msg.fromAgent} — owner: ${msg.fromHuman}`,
      confidence: 0.7,
      source: 'observed',
      tags: ['social-contact', msg.fromAgent],
    })

    // Notify owner
    await this.pushToOwner({
      event: 'social-message',
      from: msg.fromAgent,
      fromHuman: msg.fromHuman,
      content: msg.content,
      messageId: msg.id,
      thread: msg.thread,
      type: msg.type,
    })
  }

  /**
   * Handle an incoming contact request (event: 'social-contact-request')
   */
  async onContactRequest(req: ContactRequest): Promise<void> {
    console.log(`[social] Contact request from ${req.fromAgent} (${req.fromHuman}): ${req.purpose}`)

    await this.pushToOwner({
      event: 'contact-request',
      requestId: req.id,
      from: req.fromAgent,
      fromHuman: req.fromHuman,
      message: req.message,
      purpose: req.purpose,
    })
  }

  /**
   * Send a social reply back through Hub on behalf of the owner.
   * Called when the owner responds (e.g. via CLI `jackclaw social reply`).
   */
  async sendReply(params: {
    replyTo: string
    toAgent: string
    content: string
    thread?: string
  }): Promise<{ messageId: string }> {
    const hubUrl = this.config.hubUrl
    const myHandle = this.config.handle ?? `@${this.identity.nodeId}.jackclaw`

    const res = await axios.post(`${hubUrl}/api/social/reply`, {
      replyTo: params.replyTo,
      fromHuman: this.config.ownerName ?? this.identity.nodeId,
      fromAgent: myHandle,
      content: params.content,
      type: 'text',
    }, {
      headers: { Authorization: `Bearer ${this.config.hubToken}` },
    })

    return { messageId: (res.data as { messageId: string }).messageId }
  }

  /**
   * Push a notification to the owner via webhookUrl (if configured),
   * otherwise log to console so the owner can see it in node logs.
   */
  private async pushToOwner(payload: Record<string, unknown>): Promise<void> {
    const webhookUrl = this.config.ownerWebhook ?? this.config.webhookUrl
    if (webhookUrl) {
      try {
        await axios.post(webhookUrl, { source: 'jackclaw-social', ...payload }, { timeout: 5000 })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[social] Webhook push failed: ${msg}`)
      }
    } else {
      // Fallback: structured console log (visible in node terminal / logs)
      console.log('[social] OWNER NOTIFICATION:', JSON.stringify(payload, null, 2))
    }
  }
}
```

- [ ] **Step 2: Wire SocialHandler into node/src/index.ts**

In `packages/node/src/index.ts`, add the import after other imports:
```typescript
import { SocialHandler } from './social-handler'
```

Then, after `const chatClient = new NodeChatClient(...)` and the `chatClient.onMessage(...)` block, add:
```typescript
  // Initialize Social Handler
  const socialHandler = new SocialHandler(identity, config, ownerMemory)

  chatClient.onSocialEvent((event: string, data: unknown) => {
    if (event === 'social') {
      socialHandler.onSocialMessage(data as import('@jackclaw/protocol').SocialMessage).catch(() => {})
    } else if (event === 'social-contact-request') {
      socialHandler.onContactRequest(data as import('@jackclaw/protocol').ContactRequest).catch(() => {})
    }
  })
```

- [ ] **Step 3: Add `onSocialEvent` to NodeChatClient**

In `packages/node/src/chat-client.ts`, add a social event handler alongside the existing `onMessage`:

Find the `handlers` array and the `onMessage` method, then add:
```typescript
  // Social event handlers: event name → handler
  private socialHandlers: Array<(event: string, data: unknown) => void> = []

  onSocialEvent(handler: (event: string, data: unknown) => void) {
    this.socialHandlers.push(handler)
  }
```

In the WebSocket `message` handler, inside the existing `if (data.event === "message")` block, add an `else if` for social events:
```typescript
        } else if (data.event === 'social' || data.event === 'social-contact-request' || data.event === 'social-contact-response') {
          this.socialHandlers.forEach(h => h(data.event, data.data))
        }
```

- [ ] **Step 4: Build node**

```bash
cd packages/node && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 5: Commit**

```bash
cd /Users/jack/Documents/mack/orgclaw
git add packages/node/src/social-handler.ts packages/node/src/index.ts packages/node/src/chat-client.ts
git commit -m "feat: node SocialHandler — receives social events, notifies owner, sends replies"
```

---

## Task 5: CLI Social Commands — `packages/cli/src/commands/social.ts`

**Files:**
- Create: `packages/cli/src/commands/social.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Create social.ts**

```typescript
// packages/cli/src/commands/social.ts
/**
 * jackclaw social <subcommand>
 *
 *   send @bob 'Hello'          — send a social message to @bob's agent
 *   contacts                   — list accepted contacts
 *   profile [--set]            — view or set social profile
 *   inbox                      — view social inbox (messages + pending contacts)
 *   reply <messageId> 'text'   — reply to a message
 */

import { Command } from 'commander'
import chalk from 'chalk'
import axios from 'axios'
import { loadConfig, loadState, loadKeys } from '../config-utils'

export function registerSocial(program: Command): void {
  const social = program
    .command('social')
    .description('Agent social communication (human-to-human via agents)')

  // ── send ──────────────────────────────────────────────────────────────────
  social
    .command('send <toAgent> <content>')
    .description('Send a social message to another agent  e.g. @bob \'Hello!\'')
    .option('--type <type>', 'Message type: text|request|introduction|business', 'text')
    .option('--thread <threadId>', 'Attach to an existing thread')
    .action(async (toAgent: string, content: string, opts: { type: string; thread?: string }) => {
      const config = loadConfig()
      const state = loadState()
      if (!config || !state?.token) {
        console.error(chalk.red('✗ Not connected to Hub. Run: jackclaw invite <hub-url>'))
        process.exit(1)
      }

      const myHandle = config.handle ?? `@${config.nodeId}.jackclaw`
      const ownerName = config.ownerName ?? config.nodeId ?? 'unknown'

      try {
        const res = await axios.post(`${config.hubUrl}/api/social/send`, {
          fromHuman: ownerName,
          fromAgent: myHandle,
          toAgent,
          content,
          type: opts.type,
          ...(opts.thread && { thread: opts.thread }),
        }, {
          headers: { Authorization: `Bearer ${state.token}` },
        })

        const { messageId, thread, delivered } = res.data as { messageId: string; thread: string; delivered: boolean }
        console.log(chalk.green(`✓ Message sent`))
        console.log(`  ${chalk.bold('ID')}       ${chalk.gray(messageId)}`)
        console.log(`  ${chalk.bold('Thread')}   ${chalk.cyan(thread)}`)
        console.log(`  ${chalk.bold('Status')}   ${delivered ? chalk.green('delivered') : chalk.yellow('queued (agent offline)')}`)
      } catch (err: unknown) {
        const msg = err instanceof Error ? (err as any).response?.data?.error ?? err.message : String(err)
        console.error(chalk.red(`✗ Send failed: ${msg}`))
        process.exit(1)
      }
    })

  // ── contacts ──────────────────────────────────────────────────────────────
  social
    .command('contacts')
    .description('List your accepted social contacts')
    .action(async () => {
      const config = loadConfig()
      const state = loadState()
      if (!config || !state?.token) {
        console.error(chalk.red('✗ Not connected to Hub.'))
        process.exit(1)
      }

      const myHandle = config.handle ?? `@${config.nodeId}.jackclaw`

      try {
        const res = await axios.get(`${config.hubUrl}/api/social/contacts`, {
          params: { handle: myHandle },
          headers: { Authorization: `Bearer ${state.token}` },
        })
        const { contacts } = res.data as { contacts: any[] }
        if (contacts.length === 0) {
          console.log(chalk.gray('No contacts yet.'))
          return
        }
        console.log(chalk.bold(`\nContacts (${contacts.length}):\n`))
        for (const c of contacts) {
          const other = c.fromAgent === myHandle ? c.toAgent : c.fromAgent
          const otherHuman = c.fromAgent === myHandle ? '(sent by you)' : c.fromHuman
          console.log(`  ${chalk.cyan(other)}  ${chalk.gray(otherHuman)}`)
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? (err as any).response?.data?.error ?? err.message : String(err)
        console.error(chalk.red(`✗ Failed: ${msg}`))
        process.exit(1)
      }
    })

  // ── inbox ─────────────────────────────────────────────────────────────────
  social
    .command('inbox')
    .description('View social message inbox')
    .option('--limit <n>', 'Max messages to show', '20')
    .action(async (opts: { limit: string }) => {
      const config = loadConfig()
      const state = loadState()
      if (!config || !state?.token) {
        console.error(chalk.red('✗ Not connected to Hub.'))
        process.exit(1)
      }

      const myHandle = config.handle ?? `@${config.nodeId}.jackclaw`

      try {
        const res = await axios.get(`${config.hubUrl}/api/social/messages`, {
          params: { handle: myHandle, limit: opts.limit },
          headers: { Authorization: `Bearer ${state.token}` },
        })
        const { messages, pendingContacts } = res.data as { messages: any[]; pendingContacts: any[] }

        if (pendingContacts.length > 0) {
          console.log(chalk.yellow(`\nPending contact requests (${pendingContacts.length}):`))
          for (const c of pendingContacts) {
            console.log(`  ${chalk.cyan(c.id.substring(0, 8))}  from ${chalk.bold(c.fromAgent)} (${c.fromHuman})`)
            console.log(`    Purpose: ${c.purpose}`)
            console.log(`    Message: ${c.message}`)
          }
        }

        if (messages.length === 0) {
          console.log(chalk.gray('\nNo messages.'))
          return
        }

        console.log(chalk.bold(`\nMessages (${messages.length}):\n`))
        for (const m of messages) {
          const dir = m.toAgent === myHandle ? chalk.green('←') : chalk.blue('→')
          const other = m.toAgent === myHandle ? m.fromAgent : m.toAgent
          const ts = new Date(m.ts).toLocaleString()
          console.log(`  ${dir} ${chalk.cyan(other)}  ${chalk.gray(ts)}  [${chalk.yellow(m.id.substring(0, 8))}]`)
          console.log(`    ${m.content}`)
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? (err as any).response?.data?.error ?? err.message : String(err)
        console.error(chalk.red(`✗ Failed: ${msg}`))
        process.exit(1)
      }
    })

  // ── reply ─────────────────────────────────────────────────────────────────
  social
    .command('reply <messageId> <content>')
    .description('Reply to a social message by ID')
    .action(async (messageId: string, content: string) => {
      const config = loadConfig()
      const state = loadState()
      if (!config || !state?.token) {
        console.error(chalk.red('✗ Not connected to Hub.'))
        process.exit(1)
      }

      const myHandle = config.handle ?? `@${config.nodeId}.jackclaw`
      const ownerName = config.ownerName ?? config.nodeId ?? 'unknown'

      try {
        const res = await axios.post(`${config.hubUrl}/api/social/reply`, {
          replyTo: messageId,
          fromHuman: ownerName,
          fromAgent: myHandle,
          content,
          type: 'text',
        }, {
          headers: { Authorization: `Bearer ${state.token}` },
        })
        const { messageId: newId, delivered } = res.data as { messageId: string; delivered: boolean }
        console.log(chalk.green('✓ Reply sent'))
        console.log(`  ${chalk.bold('ID')}     ${chalk.gray(newId)}`)
        console.log(`  ${chalk.bold('Status')} ${delivered ? chalk.green('delivered') : chalk.yellow('queued')}`)
      } catch (err: unknown) {
        const msg = err instanceof Error ? (err as any).response?.data?.error ?? err.message : String(err)
        console.error(chalk.red(`✗ Reply failed: ${msg}`))
        process.exit(1)
      }
    })

  // ── profile ───────────────────────────────────────────────────────────────
  social
    .command('profile')
    .description('View or set your social profile')
    .option('--set', 'Set/update your profile')
    .option('--name <name>', 'Your display name')
    .option('--title <title>', 'Your title (e.g. "Founder, Acme Corp")')
    .option('--bio <bio>', 'Short bio')
    .option('--skills <skills>', 'Comma-separated skills')
    .option('--policy <policy>', 'Contact policy: open|request-only|closed', 'request-only')
    .option('--view <handle>', 'View another agent\'s profile by @handle')
    .action(async (opts: {
      set?: boolean; name?: string; title?: string; bio?: string;
      skills?: string; policy?: string; view?: string
    }) => {
      const config = loadConfig()
      const state = loadState()
      if (!config || !state?.token) {
        console.error(chalk.red('✗ Not connected to Hub.'))
        process.exit(1)
      }

      const myHandle = config.handle ?? `@${config.nodeId}.jackclaw`

      try {
        if (opts.view) {
          // View another agent's profile
          const res = await axios.get(
            `${config.hubUrl}/api/social/profile/${encodeURIComponent(opts.view)}`,
            { headers: { Authorization: `Bearer ${state.token}` } }
          )
          const { profile } = res.data as { profile: any }
          console.log(chalk.bold(`\nProfile: ${profile.agentHandle}\n`))
          console.log(`  Owner:    ${chalk.cyan(profile.ownerName)}`)
          if (profile.ownerTitle) console.log(`  Title:    ${profile.ownerTitle}`)
          if (profile.bio) console.log(`  Bio:      ${profile.bio}`)
          if (profile.skills?.length) console.log(`  Skills:   ${profile.skills.join(', ')}`)
          console.log(`  Policy:   ${chalk.yellow(profile.contactPolicy)}`)
        } else if (opts.set) {
          if (!opts.name) {
            console.error(chalk.red('✗ --name is required when setting profile'))
            process.exit(1)
          }
          const res = await axios.post(`${config.hubUrl}/api/social/profile`, {
            agentHandle: myHandle,
            ownerName: opts.name,
            ownerTitle: opts.title,
            bio: opts.bio,
            skills: opts.skills ? opts.skills.split(',').map((s: string) => s.trim()) : undefined,
            contactPolicy: opts.policy ?? 'request-only',
          }, {
            headers: { Authorization: `Bearer ${state.token}` },
          })
          const { profile } = res.data as { profile: any }
          console.log(chalk.green('✓ Profile updated'))
          console.log(`  Handle:  ${chalk.cyan(profile.agentHandle)}`)
          console.log(`  Owner:   ${profile.ownerName}`)
          console.log(`  Policy:  ${chalk.yellow(profile.contactPolicy)}`)
        } else {
          // View own profile
          const res = await axios.get(
            `${config.hubUrl}/api/social/profile/${encodeURIComponent(myHandle)}`,
            { headers: { Authorization: `Bearer ${state.token}` } }
          ).catch(() => null)

          if (!res) {
            console.log(chalk.gray('No profile set yet. Use: jackclaw social profile --set --name "Your Name"'))
            return
          }
          const { profile } = res.data as { profile: any }
          console.log(chalk.bold(`\nYour profile (${profile.agentHandle}):\n`))
          console.log(`  Owner:    ${chalk.cyan(profile.ownerName)}`)
          if (profile.ownerTitle) console.log(`  Title:    ${profile.ownerTitle}`)
          if (profile.bio) console.log(`  Bio:      ${profile.bio}`)
          if (profile.skills?.length) console.log(`  Skills:   ${profile.skills.join(', ')}`)
          console.log(`  Policy:   ${chalk.yellow(profile.contactPolicy)}`)
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? (err as any).response?.data?.error ?? err.message : String(err)
        console.error(chalk.red(`✗ Profile error: ${msg}`))
        process.exit(1)
      }
    })
}
```

- [ ] **Step 2: Register social command in cli/src/index.ts**

Add import:
```typescript
import { registerSocial } from './commands/social'
```

Add registration before `program.parse`:
```typescript
registerSocial(program);
```

- [ ] **Step 3: Build CLI**

```bash
cd packages/cli && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
cd /Users/jack/Documents/mack/orgclaw
git add packages/cli/src/commands/social.ts packages/cli/src/index.ts
git commit -m "feat: CLI social commands (send, contacts, inbox, reply, profile)"
```

---

## Task 6: Full Build Verification

**Files:** (all packages)

- [ ] **Step 1: Run full build**

```bash
cd /Users/jack/Documents/mack/orgclaw && npm run build
```
Expected: all packages build successfully, 0 errors

- [ ] **Step 2: Fix any remaining type errors**

If there are errors, read the output carefully and fix the specific issues in the files indicated.

- [ ] **Step 3: Final commit**

```bash
cd /Users/jack/Documents/mack/orgclaw
git add -A
git commit -m "feat: Agent Social Communication — human-to-human via agents"
```

- [ ] **Step 4: Notify owner**

```bash
openclaw system event --text 'Done: Agent Social Communication module — protocol/hub/node/cli all implemented' --mode now
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|---|---|
| `protocol/src/social.ts` with SocialMessage, ContactRequest, ContactResponse, SocialProfile | Task 1 |
| Export social types from `protocol/src/index.ts` | Task 1 Step 2 |
| POST /api/social/send — verify sender, lookup @handle, WebSocket push or queue | Task 3 |
| POST /api/social/contact | Task 3 |
| GET /api/social/contacts | Task 3 |
| GET /api/social/messages | Task 3 |
| POST /api/social/profile | Task 3 |
| GET /api/social/profile/:handle | Task 3 |
| POST /api/social/reply | Task 3 |
| GET /api/social/threads | Task 3 |
| Mount at `/api/social` in server.ts | Task 3 Step 4 |
| Node social-handler.ts — notify owner, push via webhook, update OwnerMemory | Task 4 |
| Wire SocialHandler in node/src/index.ts | Task 4 Step 2 |
| CLI `jackclaw social send` | Task 5 |
| CLI `jackclaw social contacts` | Task 5 |
| CLI `jackclaw social inbox` | Task 5 |
| CLI `jackclaw social reply` | Task 5 |
| CLI `jackclaw social profile` | Task 5 |
| Register social in cli/src/index.ts | Task 5 Step 2 |
| Full build passing | Task 6 |

### Placeholder Scan

No TBD, TODO, "implement later", or "similar to Task N" found. All code blocks are complete.

### Type Consistency

- `SocialMessage` fields (`fromHuman`, `fromAgent`, `toAgent`, `content`, `type`, `replyTo`, `thread`, `ts`, `_routing`) — defined in Task 1, used correctly in Tasks 3 and 5.
- `ContactRequest` fields (`id`, `fromAgent`, `toAgent`, `fromHuman`, `message`, `purpose`, `ts`, `status`) — defined in Task 1, used in Tasks 3 and 4.
- `SocialProfile` fields (`agentHandle`, `ownerName`, `ownerTitle`, `bio`, `skills`, `contactPolicy`, `updatedAt`) — defined in Task 1, used in Tasks 3 and 5.
- `getWsClient` exported from `chat.ts`, imported in `social.ts` — consistent.
- `getDirectoryEntry` from `store/directory-helpers.ts` — consistent across Task 3.
