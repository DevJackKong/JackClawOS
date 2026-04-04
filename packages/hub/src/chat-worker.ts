/**
 * ChatWorker — isolated chat processing with priority queue
 *
 * Owns the WebSocket connection pool and message delivery pipeline.
 * All IO is async/non-blocking. Never awaits LLM calls.
 *
 * Message priority (lower value = higher priority):
 *   0 → human   (direct human↔agent messages)
 *   1 → task    (task dispatch messages)
 *   2 → system  (everything else)
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import jwt from 'jsonwebtoken'
import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import { ChatStore, ChatMessage } from './store/chat'
import { isHumanTarget, getHuman, pushToHuman } from './store/human-registry'
import { pushService } from './push-service'
import { presenceManager } from './presence'
import { directoryStore } from './store/directory'
import { offlineQueue } from './store/offline-queue'
import type { MessageStatus, StatusTransition } from '@jackclaw/protocol'

// ─── Deduplication ────────────────────────────────────────────────────────────

const DEDUP_WINDOW_MS = 60_000  // 60s sliding window
const seenMessages = new Map<string, number>()  // messageId → timestamp

function isDuplicate(messageId: string): boolean {
  const now = Date.now()
  // Prune expired entries every 100 checks
  if (seenMessages.size > 0 && seenMessages.size % 100 === 0) {
    for (const [id, ts] of seenMessages) {
      if (now - ts > DEDUP_WINDOW_MS) seenMessages.delete(id)
    }
  }
  if (seenMessages.has(messageId)) return true
  seenMessages.set(messageId, now)
  return false
}

// ─── ACK tracking ─────────────────────────────────────────────────────────────

const ACK_TIMEOUT_MS = 3000   // 3s wait for delivery_ack
const RETRY_DELAY_MS = 500    // 500ms before retry
const MAX_RETRIES    = 1      // retry once

interface PendingAck {
  target: string
  msg: ChatMessage
  retries: number
  timer: NodeJS.Timeout
}

// messageId → pending ack info
const pendingAcks = new Map<string, PendingAck>()

// ─── Message trace store (in-memory, keyed by messageId) ──────────────────────

const messageTraces = new Map<string, StatusTransition[]>()

export function getMessageTrace(messageId: string): StatusTransition[] {
  return messageTraces.get(messageId) ?? []
}

export function getMessageStatus(messageId: string): MessageStatus | null {
  const trace = messageTraces.get(messageId)
  if (!trace || trace.length === 0) return null
  return trace[trace.length - 1].to
}

function recordTransition(messageId: string, from: MessageStatus, to: MessageStatus, nodeId: string): void {
  const transitions = messageTraces.get(messageId) ?? []
  transitions.push({ from, to, nodeId, ts: Date.now() })
  messageTraces.set(messageId, transitions)
}

// ─── Priority ─────────────────────────────────────────────────────────────────

const MSG_PRIORITY: Record<string, number> = { human: 0, task: 1 }

function getPriority(msg: ChatMessage): number {
  return MSG_PRIORITY[msg.type] ?? 2
}

// ─── Queue item ───────────────────────────────────────────────────────────────

interface QItem {
  priority: number
  seq: number
  target: string
  msg: ChatMessage
}

// ─── Config ───────────────────────────────────────────────────────────────────

const WS_MAX_CONNECTIONS = 1000
const HEARTBEAT_INTERVAL = 30_000
const MAX_QUEUE_MEM = 2000  // items before spilling to disk

// ─── ChatWorker ───────────────────────────────────────────────────────────────

export class ChatWorker {
  readonly store: ChatStore

  private wsClients = new Map<string, WebSocket>()
  private wsAlive   = new Map<string, boolean>()
  private heartbeatTimer: NodeJS.Timeout | null = null

  // Priority queue — sorted ascending by (priority, seq)
  private queue: QItem[] = []
  private seq = 0
  private draining = false

  // ─── Delivery ACK tracking ──────────────────────────────────────────────────
  private _ackTimers = new Map<string, NodeJS.Timeout>()
  private readonly ACK_TIMEOUT = 3000   // 3s to receive delivery_ack
  private readonly RETRY_DELAY = 500    // 500ms before retry

  // ─── Message deduplication ──────────────────────────────────────────────────
  private _recentIds = new Map<string, number>()
  private readonly DEDUPE_TTL = 60_000  // 60s sliding window
  private _dedupeTimer: NodeJS.Timeout | null = null

  // Disk overflow
  private overflowFile: string
  private overflowActive = false

  // Stats
  private totalReceived  = 0
  private totalDelivered = 0
  private totalQueued    = 0
  private latencySamples: number[] = []

  constructor(store?: ChatStore) {
    this.store = store ?? new ChatStore()

    const overflowDir = path.join(os.homedir(), '.jackclaw', 'hub', 'overflow')
    fs.mkdirSync(overflowDir, { recursive: true })
    this.overflowFile = path.join(overflowDir, 'chat-queue.ndjson')

    this._startHeartbeat()
  }

  private _startDedupeCleanup(): void {
    // no-op: dedup cleanup handled by module-level seenMessages map
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Accept an incoming message, expand group targets, and enqueue for delivery.
   * Saves to store immediately; delivery happens asynchronously.
   */
  handleIncoming(msg: ChatMessage): void {
    // ─── Deduplication ─────────────────────────────────────────────────────────
    if (isDuplicate(msg.id)) {
      this.pushEvent(msg.from, 'receipt', {
        messageId: msg.id, status: 'duplicate' as MessageStatus, nodeId: 'hub', ts: Date.now()
      })
      return
    }

    this.totalReceived++
    this.store.saveMessage(msg)

    // Record trace: → accepted
    recordTransition(msg.id, 'accepted' as MessageStatus, 'accepted' as MessageStatus, 'hub')

    // Notify sender: hub received and stored the message
    this.pushEvent(msg.from, 'receipt', {
      messageId: msg.id, status: 'accepted' as MessageStatus, nodeId: 'hub', ts: Date.now()
    })

    const toId = Array.isArray(msg.to) ? msg.to[0] : msg.to
    const group = this.store.getGroup(toId)
    const targets = group
      ? group.members.filter(m => m !== msg.from)
      : (Array.isArray(msg.to) ? msg.to : [msg.to])

    const priority = getPriority(msg)

    for (const target of targets) {
      const payload = group
        ? { ...msg, groupId: group.groupId, groupName: group.name } as ChatMessage
        : msg
      this._enqueue(priority, target, payload)
    }
  }

  /**
   * Deliver a single message to target.
   * WebSocket if online; offline queue otherwise.
   * Human targets are routed via agentNodeId or direct webhook.
   */
  deliver(target: string, msg: ChatMessage): void {
    if (isHumanTarget(target)) {
      this._deliverToHuman(target, msg)
      return
    }

    const ws = this.wsClients.get(target)
    if (ws && ws.readyState === WebSocket.OPEN) {
      const payload = JSON.stringify({ event: 'message', data: msg })
      ws.send(payload, (err) => {
        if (err) {
          // ws.send failed — retry once after 500ms
          console.warn(`[chat-worker] ws.send failed for ${target}: ${err.message}`)
          recordTransition(msg.id, 'accepted' as MessageStatus, 'failed' as MessageStatus, target)
          setTimeout(() => this._retryDeliver(target, msg, 0), RETRY_DELAY_MS)
        } else {
          // Sent successfully — record transition and start ACK timer
          this.totalDelivered++
          recordTransition(msg.id, 'accepted' as MessageStatus, 'sent' as MessageStatus, target)
          this.pushEvent(msg.from, 'receipt', {
            messageId: msg.id, status: 'sent' as MessageStatus, nodeId: target, ts: Date.now()
          })
          this._startAckTimer(msg.id, target, msg)
        }
      })
    } else {
      this._queueOffline(target, msg)
    }
  }

  /** Retry delivery once, then queue offline */
  private _retryDeliver(target: string, msg: ChatMessage, attempt: number): void {
    if (attempt >= MAX_RETRIES) {
      this._queueOffline(target, msg)
      return
    }
    const ws = this.wsClients.get(target)
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: 'message', data: msg }), (err) => {
        if (err) {
          this._queueOffline(target, msg)
        } else {
          this.totalDelivered++
          recordTransition(msg.id, 'failed' as MessageStatus, 'sent' as MessageStatus, target)
          this.pushEvent(msg.from, 'receipt', {
            messageId: msg.id, status: 'sent' as MessageStatus, nodeId: target, ts: Date.now()
          })
          this._startAckTimer(msg.id, target, msg)
        }
      })
    } else {
      this._queueOffline(target, msg)
    }
  }

  /** Start ACK timeout — if no delivery_ack within 3s, queue offline */
  private _startAckTimer(messageId: string, target: string, msg: ChatMessage): void {
    // Clear any existing timer
    const existing = pendingAcks.get(messageId)
    if (existing) clearTimeout(existing.timer)

    const timer = setTimeout(() => {
      // ACK timeout — queue offline
      pendingAcks.delete(messageId)
      recordTransition(messageId, 'sent' as MessageStatus, 'failed' as MessageStatus, target)
      this._queueOffline(target, msg)
    }, ACK_TIMEOUT_MS)
    timer.unref()

    pendingAcks.set(messageId, { target, msg, retries: 0, timer })
  }

  /** Called when we receive a delivery_ack from a node */
  handleDeliveryAck(messageId: string, nodeId: string): void {
    const pending = pendingAcks.get(messageId)
    if (pending) {
      clearTimeout(pending.timer)
      pendingAcks.delete(messageId)
    }
    recordTransition(messageId, 'sent' as MessageStatus, 'acked' as MessageStatus, nodeId)
    // Find the original sender to notify
    const trace = messageTraces.get(messageId)
    if (trace && trace.length > 0) {
      this.pushEvent(trace[0].nodeId, 'receipt', {
        messageId, status: 'acked' as MessageStatus, nodeId, ts: Date.now()
      })
    }
  }

  /** Queue message offline with push notification */
  private _queueOffline(target: string, msg: ChatMessage): void {
    this.store.queueForOffline(target, msg)
    this.totalQueued++
    recordTransition(msg.id, 'sent' as MessageStatus, 'failed' as MessageStatus, target)
    // Notify via Web Push
    setImmediate(() => {
      void pushService.push(target, {
        title: `New message from ${msg.from}`,
        body: (typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)).slice(0, 120),
        data: { type: 'chat', messageId: msg.id, from: msg.from },
      })
    })
  }

  /**
   * Enqueue delivery to multiple targets at the same priority.
   */
  broadcast(targets: string[], msg: ChatMessage): void {
    const priority = getPriority(msg)
    for (const target of targets) {
      this._enqueue(priority, target, msg)
    }
  }

  /**
   * Push an arbitrary event to a connected node's WebSocket.
   * Returns false if node is offline (caller handles queueing).
   */
  pushEvent(nodeId: string, event: string, data: unknown): boolean {
    const ws = this.wsClients.get(nodeId)
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event, data }))
      return true
    }
    return false
  }

  /** Raw WebSocket access (for social route offline queueing) */
  getClientWs(nodeId: string): WebSocket | undefined {
    return this.wsClients.get(nodeId)
  }

  getStats() {
    const avg = this.latencySamples.length > 0
      ? this.latencySamples.reduce((a, b) => a + b, 0) / this.latencySamples.length
      : 0
    return {
      connections:    this.wsClients.size,
      queueDepth:     this.queue.length,
      overflowActive: this.overflowActive,
      totalReceived:  this.totalReceived,
      totalDelivered: this.totalDelivered,
      totalQueued:    this.totalQueued,
      avgLatencyMs:   Math.round(avg),
    }
  }

  // ─── WebSocket server ────────────────────────────────────────────────────────

  attachWss(server: import('http').Server): WebSocketServer {
    const wss = new WebSocketServer({ server, path: '/chat/ws' })

    wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const url       = new URL(req.url ?? '', 'http://localhost')
      let nodeId      = url.searchParams.get('nodeId')
      const tokenParam = url.searchParams.get('token')

      // JWT auth: verify token → derive nodeId from the user's agentNodeId
      if (!nodeId && tokenParam) {
        try {
          // Lazy imports to avoid load-time circular deps
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { JWT_SECRET } = require('./server') as typeof import('./server')
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { userStore } = require('./store/users') as typeof import('./store/users')
          const payload = jwt.verify(tokenParam, JWT_SECRET) as { handle?: string }
          if (payload.handle) {
            const user = userStore.getUser(payload.handle)
            if (user?.agentNodeId) nodeId = user.agentNodeId
          }
        } catch { /* invalid token — nodeId stays null → close below */ }
      }

      if (!nodeId) {
        ws.close(4001, 'nodeId required')
        return
      }

      if (this.wsClients.size >= WS_MAX_CONNECTIONS) {
        console.warn(`[chat-worker] Connection limit reached (${WS_MAX_CONNECTIONS}), rejecting ${nodeId}`)
        ws.close(4503, 'Service Unavailable: connection limit reached')
        return
      }

      this.wsClients.set(nodeId, ws)
      this.wsAlive.set(nodeId, true)
      presenceManager.setOnline(nodeId, ['ws'])
      console.log(`[chat-worker] ${nodeId} connected (total: ${this.wsClients.size})`)

      ws.on('pong', () => {
        this.wsAlive.set(nodeId, true)
        presenceManager.heartbeat(nodeId)
      })

      // Drain chat offline inbox
      for (const offlineMsg of this.store.drainInbox(nodeId)) {
        ws.send(JSON.stringify({ event: 'message', data: offlineMsg }))
      }

      // Drain unified offline queue for all @handles associated with this node
      const handles = directoryStore.getHandlesForNode(nodeId)
      for (const handle of handles) {
        for (const envelope of offlineQueue.dequeue(handle)) {
          ws.send(JSON.stringify(envelope))
        }
      }

      ws.on('message', (raw) => {
        try {
          const parsed = JSON.parse(raw.toString())

          // ─── Handle delivery_ack from Node ─────────────────────────────────
          if (parsed.event === 'delivery_ack' && parsed.messageId) {
            this.handleDeliveryAck(parsed.messageId, nodeId!)
            return
          }

          // ─── Handle stored confirmation from Node ──────────────────────────
          if (parsed.event === 'stored' && parsed.messageId) {
            recordTransition(parsed.messageId, 'acked' as MessageStatus, 'stored' as MessageStatus, nodeId!)
            return
          }

          // ─── Handle consumed confirmation from Node ────────────────────────
          if (parsed.event === 'consumed' && parsed.messageId) {
            recordTransition(parsed.messageId, 'stored' as MessageStatus, 'consumed' as MessageStatus, nodeId!)
            return
          }

          // ─── Regular chat message ──────────────────────────────────────────
          const msg = parsed as ChatMessage

          // Enqueue for priority delivery — never block the WS event loop
          this.handleIncoming(msg)

          // task → fire-and-forget planner (no await)
          if (msg.type === 'task') {
            setImmediate(() => { void this._triggerPlanner(msg) })
          }

          // human → observe for OwnerMemory (fire-and-forget)
          if (msg.type === 'human') {
            setImmediate(() => {
              this.store.observeMessage(msg.from, {
                content:   msg.content,
                direction: 'incoming',
                type:      msg.type,
              })
            })
          }

          ws.send(JSON.stringify({ event: 'ack', messageId: msg.id }))
        } catch {
          ws.send(JSON.stringify({ event: 'error', message: 'Invalid message format' }))
        }
      })

      ws.on('close', () => {
        this.wsClients.delete(nodeId)
        this.wsAlive.delete(nodeId)
        presenceManager.setOffline(nodeId)
        console.log(`[chat-worker] ${nodeId} disconnected (total: ${this.wsClients.size})`)
      })
    })

    return wss
  }

  // ─── Private: priority queue ─────────────────────────────────────────────────

  private _enqueue(priority: number, target: string, msg: ChatMessage): void {
    const item: QItem = { priority, seq: this.seq++, target, msg }

    if (this.queue.length >= MAX_QUEUE_MEM) {
      this._spillToDisk(item)
      this.overflowActive = true
    } else {
      this._insertSorted(item)
    }

    if (!this.draining) {
      setImmediate(() => this._drain())
    }
  }

  /** Binary-search insert to maintain priority-ascending (FIFO within same priority) order */
  private _insertSorted(item: QItem): void {
    let lo = 0, hi = this.queue.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      const q = this.queue[mid]
      if (q.priority < item.priority || (q.priority === item.priority && q.seq < item.seq)) {
        lo = mid + 1
      } else {
        hi = mid
      }
    }
    this.queue.splice(lo, 0, item)
  }

  private _drain(): void {
    if (this.queue.length === 0) {
      if (this.overflowActive) {
        this._reloadFromDisk()
        if (this.queue.length > 0) {
          // Items reloaded — keep draining
          setImmediate(() => this._drain())
          return
        }
      }
      this.draining = false
      return
    }

    this.draining = true
    const item  = this.queue.shift()!
    const start = Date.now()

    this.deliver(item.target, item.msg)

    const latency = Date.now() - start
    this.latencySamples.push(latency)
    if (this.latencySamples.length > 100) this.latencySamples.shift()

    setImmediate(() => this._drain())
  }

  // ─── Private: disk overflow ──────────────────────────────────────────────────

  private _spillToDisk(item: QItem): void {
    try {
      fs.appendFileSync(this.overflowFile, JSON.stringify(item) + '\n')
    } catch (e) {
      console.error('[chat-worker] Overflow spill failed:', e)
    }
  }

  private _reloadFromDisk(): void {
    if (!fs.existsSync(this.overflowFile)) {
      this.overflowActive = false
      return
    }
    try {
      const data = fs.readFileSync(this.overflowFile, 'utf-8')
      fs.unlinkSync(this.overflowFile)
      this.overflowActive = false
      for (const line of data.trim().split('\n').filter(Boolean)) {
        const item = JSON.parse(line) as QItem
        // Re-insert without triggering another disk spill
        if (this.queue.length < MAX_QUEUE_MEM) {
          this._insertSorted(item)
        } else {
          this._spillToDisk(item)
          this.overflowActive = true
        }
      }
    } catch (e) {
      console.error('[chat-worker] Overflow reload failed:', e)
      this.overflowActive = false
    }
  }

  // ─── Private: heartbeat ──────────────────────────────────────────────────────

  private _startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      for (const [nodeId, ws] of this.wsClients) {
        if (!this.wsAlive.get(nodeId)) {
          console.log(`[chat-worker] ${nodeId} heartbeat timeout, closing`)
          ws.terminate()
          this.wsClients.delete(nodeId)
          this.wsAlive.delete(nodeId)
          presenceManager.setOffline(nodeId)
          continue
        }
        this.wsAlive.set(nodeId, false)
        ws.ping()
      }
    }, HEARTBEAT_INTERVAL)
    // Don't prevent process exit
    this.heartbeatTimer.unref()
  }

  // ─── Private: task planner ───────────────────────────────────────────────────

  private async _triggerPlanner(msg: ChatMessage): Promise<void> {
    try {
      const resp = await fetch('http://localhost:3100/api/plan/estimate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          taskId:      msg.id,
          title:       msg.content.slice(0, 80),
          description: msg.content,
          useAi:       false,
        }),
      })
      const { plan, formatted } = await resp.json() as { plan: unknown; formatted?: string }
      const planMsg: ChatMessage = {
        id:        `plan-${msg.id}`,
        from:      'hub-planner',
        to:        msg.from,
        content:   formatted ?? JSON.stringify(plan),
        type:      'plan-result',
        ts:        Date.now(),
        signature: '',
        encrypted: false,
        metadata:  { plan },
      }
      // deliver through normal path — queued if sender is offline
      this.deliver(msg.from, planMsg)
    } catch { /* planner failure never blocks routing */ }
  }

  // ─── Private: human delivery ─────────────────────────────────────────────────

  private _deliverToHuman(target: string, msg: ChatMessage): void {
    const human = getHuman(target)
    if (!human) return

    if (human.agentNodeId) {
      const agentPayload: ChatMessage = {
        ...msg,
        to: human.agentNodeId,
        metadata: {
          ...msg.metadata,
          humanTarget:       human.humanId,
          humanDisplayName:  human.displayName,
        },
      }
      const agentWs = this.wsClients.get(human.agentNodeId)
      if (agentWs && agentWs.readyState === WebSocket.OPEN) {
        agentWs.send(JSON.stringify({ event: 'message', data: agentPayload }))
        this.totalDelivered++
      } else {
        this.store.queueForOffline(human.agentNodeId, agentPayload)
        this.totalQueued++
      }
    } else {
      // No agent — direct webhook fallback (fire-and-forget)
      pushToHuman(human, { from: msg.from, content: msg.content, type: msg.type, id: msg.id })
        .catch(() => {})
      this.totalDelivered++
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const chatWorker = new ChatWorker()
