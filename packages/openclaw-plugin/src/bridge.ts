/**
 * bridge.ts — Bridges JackClaw Hub/Node with OpenClaw's messaging system.
 *
 * Provides lightweight HTTP client functions that query the local Hub REST API
 * so the plugin stays dependency-free (no extra SDK needed).
 */

const DEFAULT_HUB_URL = process.env['JACKCLAW_HUB_URL'] ?? 'http://localhost:3100'
const CEO_TOKEN = process.env['JACKCLAW_CEO_TOKEN'] ?? ''

export interface HubNode {
  nodeId: string
  name: string
  role: string
  registeredAt: number
  lastReportAt?: number
}

export interface HubReport {
  nodeId: string
  messageId: string
  timestamp: number
  summary: string
  period: string
  visibility: 'full' | 'summary_only' | 'private'
}

export interface HubSummary {
  date: string
  byRole: Record<string, {
    role: string
    nodes: Array<{
      nodeId: string
      name: string
      summary: string
      period: string
      reportedAt: number
    }>
  }>
  totalNodes: number
  reportingNodes: number
}

// ─── Chat interfaces ──────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string
  from: string
  to: string
  content: string
  timestamp: number
  threadId?: string
}

export interface ChatThread {
  threadId: string
  participants: string[]
  title?: string
  lastMessage?: ChatMessage
  updatedAt: number
}

export interface SendChatResult {
  status: string
  messageId: string
}

export interface InboxResult {
  messages: ChatMessage[]
  count: number
}

export interface ThreadsResult {
  threads: ChatThread[]
}

// ─── Presence / search interfaces ────────────────────────────────────────────

export interface OnlineUser {
  handle: string
  nodeId: string
  displayName: string
  role: string
  onlineSince: number | null
}

export interface ContactResult {
  handle: string
  displayName: string
  nodeId: string
  role: string
  online: boolean
}

// ─── ClawChat Auth (re-exported from clawchat-auth.ts) ───────────────────────

export { getClawChatAuth, ensureClawChatAuth } from './clawchat-auth.js'
export type { ClawChatCredentials as ClawChatAuth } from './clawchat-auth.js'

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

/** Read JWT from ~/.jackclaw/clawchat-auth.json, fallback to empty string. */
export async function readChatJwt(): Promise<string> {
  try {
    const { default: os } = await import('os')
    const { default: path } = await import('path')
    const { default: fs } = await import('fs/promises')
    const filePath = path.join(os.homedir(), '.jackclaw', 'clawchat-auth.json')
    const raw = await fs.readFile(filePath, 'utf8')
    const data = JSON.parse(raw) as { token?: string }
    return data.token ?? ''
  } catch {
    return ''
  }
}

async function hubGet<T>(path: string): Promise<T> {
  const url = `${DEFAULT_HUB_URL}${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (CEO_TOKEN) {
    headers['Authorization'] = `Bearer ${CEO_TOKEN}`
  }

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) })
  if (!res.ok) {
    throw new Error(`Hub request failed: ${res.status} ${res.statusText} [${path}]`)
  }
  return res.json() as Promise<T>
}

/** Fetch all registered nodes from Hub. */
export async function fetchNodes(): Promise<HubNode[]> {
  const data = await hubGet<{ nodes: HubNode[] }>('/api/nodes')
  return data.nodes ?? []
}

/** Fetch today's summary from Hub. */
export async function fetchSummary(): Promise<HubSummary> {
  return hubGet<HubSummary>('/api/summary')
}

/** Check if Hub is reachable. */
export async function hubHealthCheck(): Promise<boolean> {
  try {
    await hubGet<unknown>('/health')
    return true
  } catch {
    return false
  }
}

/** Format node list as readable text. */
export function formatNodeStatus(nodes: HubNode[]): string {
  if (nodes.length === 0) return '暂无已注册节点。'

  const now = Date.now()
  const lines = nodes.map((n) => {
    const lastReport = n.lastReportAt
      ? `上次汇报：${Math.round((now - n.lastReportAt) / 60000)} 分钟前`
      : '尚未汇报'
    const online = n.lastReportAt && now - n.lastReportAt < 5 * 60 * 1000 ? '🟢' : '⚫'
    return `${online} **${n.name}** (${n.role}) — ${lastReport}`
  })

  return `📡 节点状态 (${nodes.length} 个)\n\n${lines.join('\n')}`
}

async function hubPost<T>(path: string, body: unknown, token?: string): Promise<T> {
  const url = `${DEFAULT_HUB_URL}${path}`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const bearerToken = token ?? CEO_TOKEN
  if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) {
    throw new Error(`Hub POST request failed: ${res.status} ${res.statusText} [${path}]`)
  }
  return res.json() as Promise<T>
}

async function hubGetAuth<T>(path: string, token?: string): Promise<T> {
  const url = `${DEFAULT_HUB_URL}${path}`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const bearerToken = token ?? CEO_TOKEN
  if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) })
  if (!res.ok) {
    throw new Error(`Hub GET request failed: ${res.status} ${res.statusText} [${path}]`)
  }
  return res.json() as Promise<T>
}

/** Send a ClawChat message via Hub. */
export async function sendChatMessage(
  from: string,
  to: string,
  content: string,
  threadId?: string,
): Promise<SendChatResult> {
  const token = await readChatJwt()
  const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const msg: ChatMessage = { id, from, to, content, timestamp: Date.now() }
  if (threadId) msg.threadId = threadId
  return hubPost<SendChatResult>('/api/chat/send', msg, token)
}

/** Fetch unread inbox messages for a node. */
export async function fetchChatInbox(nodeId: string): Promise<InboxResult> {
  const token = await readChatJwt()
  return hubGetAuth<InboxResult>(`/api/chat/inbox?nodeId=${encodeURIComponent(nodeId)}`, token)
}

/** Fetch thread list for a node. */
export async function fetchChatThreads(nodeId: string): Promise<ThreadsResult> {
  const token = await readChatJwt()
  return hubGetAuth<ThreadsResult>(`/api/chat/threads?nodeId=${encodeURIComponent(nodeId)}`, token)
}

/** Format chat inbox as readable text. */
export function formatChatInbox(result: InboxResult): string {
  if (result.count === 0) return '📭 收件箱为空，暂无未读消息。'

  const lines = result.messages.map((m) => {
    const time = new Date(m.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    const thread = m.threadId ? ` [线程 ${m.threadId}]` : ''
    return `• **${m.from}** → ${m.to}${thread} (${time})\n  ${m.content}`
  })

  return `📬 未读消息 (${result.count} 条)\n\n${lines.join('\n\n')}`
}

/** Format thread list as readable text. */
export function formatChatThreads(result: ThreadsResult): string {
  if (result.threads.length === 0) return '💬 暂无会话。'

  const lines = result.threads.map((t) => {
    const updated = new Date(t.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    const title = t.title ?? t.participants.join(' ↔ ')
    return `• [${t.threadId}] **${title}** — 更新于 ${updated}`
  })

  return `💬 会话列表 (${result.threads.length} 个)\n\n${lines.join('\n')}`
}

/** Fetch currently online users from Hub presence endpoint. */
export async function fetchOnlineUsers(): Promise<OnlineUser[]> {
  const data = await hubGet<{ users: OnlineUser[] }>('/api/presence/online')
  return data.users ?? []
}

/** Search contacts by keyword (handle or displayName). */
export async function fetchContactSearch(keyword: string): Promise<ContactResult[]> {
  const data = await hubGet<{ contacts: ContactResult[] }>(
    `/api/search/contacts?q=${encodeURIComponent(keyword)}`,
  )
  return data.contacts ?? []
}

/** Format online user list as readable text. */
export function formatOnlineUsers(users: OnlineUser[]): string {
  if (users.length === 0) return '🔇 当前没有在线用户。'

  const lines = users.map(u => `🟢 @${u.handle} (${u.displayName}) — ${u.role}`)
  return `👥 在线用户 (${users.length} 人)\n\n${lines.join('\n')}`
}

/** Format contact search results as readable text. */
export function formatContactSearch(contacts: ContactResult[], keyword: string): string {
  if (contacts.length === 0) return `🔍 未找到匹配 "${keyword}" 的用户。`

  const lines = contacts.map(c => {
    const status = c.online ? '🟢在线' : '⚫离线'
    return `@${c.handle} (${c.displayName}) ${status}`
  })
  return `🔍 搜索 "${keyword}" — ${contacts.length} 个结果\n\n${lines.join('\n')}`
}

/** Format daily summary as readable text. */
export function formatSummary(summary: HubSummary): string {
  const roleEntries = Object.values(summary.byRole)

  if (roleEntries.length === 0) {
    return `📋 今日汇报 (${summary.date})\n\n暂无汇报数据。`
  }

  const sections = roleEntries.map((role) => {
    const header = `**[${role.role}]**`
    const items = role.nodes.map((n) => `  • ${n.name}：${n.summary}`).join('\n')
    return `${header}\n${items}`
  })

  return (
    `📋 今日汇报摘要 (${summary.date})\n` +
    `汇报节点：${summary.reportingNodes}/${summary.totalNodes}\n\n` +
    sections.join('\n\n')
  )
}
