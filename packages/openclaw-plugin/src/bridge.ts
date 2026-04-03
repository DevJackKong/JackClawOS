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
