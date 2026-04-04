/**
 * ClawChat Hub Store — 消息存储、离线队列、会话管理
 */

import { randomUUID } from 'crypto'
import { messageStore } from './message-store'
import type { StoredMessage } from './message-store'

export interface ChatGroup {
  groupId: string
  name: string
  members: string[]    // nodeId 列表
  createdBy: string
  createdAt: number
  topic?: string
}

export type ChatMessageType =
  | 'human'
  | 'task'
  | 'ask'
  | 'broadcast'
  | 'reply'
  | 'ack'
  | 'plan-result'

export interface ChatMessage {
  id: string
  threadId?: string
  replyToId?: string
  from: string
  to: string | string[]
  type: ChatMessageType
  content: string
  attachments?: Array<{
    name: string
    type: 'file' | 'image' | 'memory-ref' | 'task-result'
    url?: string
    data?: string
    memoryKey?: string
  }>
  ts: number
  signature: string
  encrypted: boolean
  read?: boolean
  metadata?: Record<string, unknown>
  executionResult?: {
    status: 'success' | 'failed' | 'pending-review'
    output: string
    attempts: number
  }
}

export interface ChatThread {
  id: string
  participants: string[]
  title?: string
  createdAt: number
  lastMessageAt: number
  messageCount: number
}

function storedToChat(s: StoredMessage): ChatMessage {
  return {
    id:        s.id,
    threadId:  s.threadId,
    replyToId: s.replyTo,
    from:      s.fromAgent,
    to:        s.toAgent,
    type:      s.type as ChatMessageType,
    content:   s.content,
    attachments: s.attachments as ChatMessage['attachments'],
    ts:        s.ts,
    signature: '',
    encrypted: s.encrypted,
  }
}

export class ChatStore {
  private messages: Map<string, ChatMessage> = new Map()
  private threads: Map<string, ChatThread> = new Map()
  private inbox: Map<string, ChatMessage[]> = new Map()
  private groups: Map<string, ChatGroup> = new Map()
  // nodeId → 活跃时间统计（轻量观察，不做深度分析）
  private activityLog: Map<string, number[]> = new Map()

  getMessage(id: string): ChatMessage | undefined {
    return this.messages.get(id)
  }

  saveMessage(msg: ChatMessage): void {
    this.messages.set(msg.id, msg)
    if (msg.threadId) {
      const thread = this.threads.get(msg.threadId)
      if (thread) {
        thread.lastMessageAt = msg.ts
        thread.messageCount++
      }
    }
    // Persist to SQLite / JSONL
    const stored: StoredMessage = {
      id:          msg.id,
      threadId:    msg.threadId,
      fromAgent:   msg.from,
      toAgent:     Array.isArray(msg.to) ? JSON.stringify(msg.to) : msg.to,
      content:     msg.content,
      type:        msg.type,
      replyTo:     msg.replyToId,
      attachments: msg.attachments,
      status:      msg.executionResult?.status ?? 'sent',
      ts:          msg.ts,
      encrypted:   msg.encrypted,
    }
    try { messageStore.saveMessage(stored) } catch { /* persistence is best-effort */ }
  }

  getThread(threadId: string): ChatMessage[] {
    // Try persistent store first; fall back to in-memory
    try {
      const stored = messageStore.getThread(threadId, 200, 0)
      if (stored.length > 0) {
        return stored.map(s => storedToChat(s))
      }
    } catch { /* fall through */ }
    return [...this.messages.values()]
      .filter(m => m.threadId === threadId)
      .sort((a, b) => a.ts - b.ts)
  }

  getInbox(nodeId: string): ChatMessage[] {
    return this.inbox.get(nodeId) ?? []
  }

  queueForOffline(nodeId: string, msg: ChatMessage): void {
    const q = this.inbox.get(nodeId) ?? []
    q.push(msg)
    this.inbox.set(nodeId, q)
  }

  drainInbox(nodeId: string): ChatMessage[] {
    const msgs = this.inbox.get(nodeId) ?? []
    this.inbox.delete(nodeId)
    return msgs
  }

  createThread(participants: string[], title?: string): ChatThread {
    const thread: ChatThread = {
      id: randomUUID(),
      participants,
      title,
      createdAt: Date.now(),
      lastMessageAt: Date.now(),
      messageCount: 0,
    }
    this.threads.set(thread.id, thread)
    return thread
  }

  listThreads(nodeId: string): ChatThread[] {
    return [...this.threads.values()]
      .filter(t => t.participants.includes(nodeId))
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
  }

  /** Hub 侧轻量观察：记录活跃时间戳，供 Node 侧 OwnerMemory 消费 */
  observeMessage(nodeId: string, opts: { content: string; direction: string; type: string }): void {
    const log = this.activityLog.get(nodeId) ?? []
    log.push(Date.now())
    // 只保留最近100条时间戳
    if (log.length > 100) log.splice(0, log.length - 100)
    this.activityLog.set(nodeId, log)
  }

  getActivityLog(nodeId: string): number[] {
    return this.activityLog.get(nodeId) ?? []
  }

  // ─── 群组管理 ─────────────────────────────────────────────────────────────────

  createGroup(name: string, members: string[], createdBy: string, topic?: string): ChatGroup {
    const group: ChatGroup = {
      groupId: randomUUID(),
      name,
      members,
      createdBy,
      createdAt: Date.now(),
      topic,
    }
    this.groups.set(group.groupId, group)
    return group
  }

  getGroup(groupId: string): ChatGroup | null {
    return this.groups.get(groupId) ?? null
  }

  listGroups(nodeId: string): ChatGroup[] {
    return [...this.groups.values()]
      .filter(g => g.members.includes(nodeId))
      .sort((a, b) => b.createdAt - a.createdAt)
  }
}
