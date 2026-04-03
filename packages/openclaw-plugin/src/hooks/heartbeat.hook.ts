/**
 * heartbeat.hook.ts — OpenClaw heartbeat 集成钩子
 *
 * 当 OpenClaw heartbeat 触发时调用这些函数：
 *   - onHeartbeat:         同步本地 shared memory 到 Hub
 *   - checkPendingInvites: 检查 Hub 上待处理的协作邀请并通知用户
 *   - checkWatchdogAlerts: 检查 Watchdog 告警，critical 级别立即推送
 *
 * 使用方式（在 plugin.ts 中通过 api.on('heartbeat', ...) 绑定）：
 *
 *   import { onHeartbeat, checkPendingInvites, checkWatchdogAlerts } from './hooks/heartbeat.hook.js'
 *
 *   api.on('heartbeat', async (_event, ctx) => {
 *     await onHeartbeat(nodeId, hubUrl)
 *     await checkPendingInvites(nodeId, hubUrl)
 *     await checkWatchdogAlerts(nodeId, hubUrl)
 *   })
 */

const DEFAULT_HUB_URL = process.env['JACKCLAW_HUB_URL'] ?? 'http://localhost:3100'
const CEO_TOKEN = process.env['JACKCLAW_CEO_TOKEN'] ?? ''

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SharedMemoryEntry {
  key: string
  value: unknown
  updatedAt: number
  tags?: string[]
}

export interface CollabInvite {
  inviteId: string
  fromNodeId: string
  fromName: string
  topic: string
  createdAt: number
  expiresAt?: number
}

export type AlertSeverity = 'info' | 'warning' | 'critical'

export interface WatchdogAlert {
  alertId: string
  nodeId: string
  severity: AlertSeverity
  message: string
  triggeredAt: number
  acknowledged: boolean
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function hubRequest<T>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${DEFAULT_HUB_URL}${path}`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (CEO_TOKEN) headers['Authorization'] = `Bearer ${CEO_TOKEN}`

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) {
    throw new Error(`Hub ${method} ${path} → ${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

// ─── Shared memory helpers ────────────────────────────────────────────────────

/**
 * Read local shared memory entries from the file system or in-process store.
 * Falls back to an empty array if the file does not exist.
 */
async function readLocalMemory(nodeId: string): Promise<SharedMemoryEntry[]> {
  // Attempt to load from a well-known workspace path.
  // OpenClaw workspace conventions: ~/.openclaw/workspace/memory/shared-<nodeId>.json
  const os = await import('os')
  const path = await import('path')
  const fs = await import('fs/promises')

  const filePath = path.join(os.homedir(), '.openclaw', 'workspace', 'memory', `shared-${nodeId}.json`)
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw) as SharedMemoryEntry[]
  } catch {
    return []
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * onHeartbeat — 每次 OpenClaw heartbeat 触发时调用。
 *
 * 将本地 shared memory 的最新快照同步到 Hub，
 * 以便其他节点通过 Hub 读取该节点的上下文。
 */
export async function onHeartbeat(nodeId: string, hubUrl: string = DEFAULT_HUB_URL): Promise<void> {
  const entries = await readLocalMemory(nodeId)

  if (entries.length === 0) {
    // Nothing to sync — Hub will retain the previous snapshot.
    return
  }

  await hubRequest<{ ok: boolean }>('PUT', `/api/nodes/${nodeId}/memory`, {
    nodeId,
    entries,
    syncedAt: Date.now(),
  })
}

/**
 * checkPendingInvites — 检查 Hub 上是否有该节点待确认的协作邀请。
 *
 * 如果发现新邀请，通过 Node 配置的通知渠道推送给用户。
 * 调用方应在收到邀请列表后决定是否 accept/decline。
 */
export async function checkPendingInvites(
  nodeId: string,
  hubUrl: string = DEFAULT_HUB_URL,
): Promise<CollabInvite[]> {
  let invites: CollabInvite[] = []
  try {
    const data = await hubRequest<{ invites: CollabInvite[] }>(
      'GET',
      `/api/nodes/${nodeId}/invites`,
    )
    invites = data.invites ?? []
  } catch (err) {
    // Hub unreachable or node has no invites endpoint yet — degrade gracefully
    console.warn(`[heartbeat] checkPendingInvites error: ${String(err)}`)
    return []
  }

  if (invites.length === 0) return []

  // Format a human-readable summary for push notification
  const lines = invites.map(
    (inv) =>
      `• ${inv.fromName} (${inv.fromNodeId}) 邀请协作：${inv.topic}` +
      (inv.expiresAt ? `（过期：${new Date(inv.expiresAt).toLocaleString('zh-CN')}）` : ''),
  )

  const text =
    `🤝 JackClaw 协作邀请 (${invites.length} 条)\n\n${lines.join('\n')}\n\n` +
    `回复 /jackclaw invite accept <inviteId> 或 decline <inviteId> 处理。`

  // Emit to OpenClaw notification bus (best-effort; process may not be bound)
  emitNotification(text)

  return invites
}

/**
 * checkWatchdogAlerts — 拉取 Watchdog 告警列表。
 *
 * critical 级告警立即推送；warning/info 级在下一次日报中汇总。
 * 推送后自动 acknowledge，避免重复通知。
 */
export async function checkWatchdogAlerts(
  nodeId: string,
  hubUrl: string = DEFAULT_HUB_URL,
): Promise<WatchdogAlert[]> {
  let alerts: WatchdogAlert[] = []
  try {
    const data = await hubRequest<{ alerts: WatchdogAlert[] }>(
      'GET',
      `/api/nodes/${nodeId}/alerts?acknowledged=false`,
    )
    alerts = data.alerts ?? []
  } catch (err) {
    console.warn(`[heartbeat] checkWatchdogAlerts error: ${String(err)}`)
    return []
  }

  const criticals = alerts.filter((a) => a.severity === 'critical')

  if (criticals.length > 0) {
    const lines = criticals.map(
      (a) =>
        `🚨 [${a.nodeId}] ${a.message} (${new Date(a.triggeredAt).toLocaleTimeString('zh-CN')})`,
    )
    const text = `⚠️ JackClaw Watchdog 严重告警 (${criticals.length} 条)\n\n${lines.join('\n')}`
    emitNotification(text)

    // Acknowledge criticals in batch so they don't re-notify
    const ids = criticals.map((a) => a.alertId)
    try {
      await hubRequest('POST', `/api/nodes/${nodeId}/alerts/acknowledge`, { alertIds: ids })
    } catch {
      // Non-fatal — will retry on next heartbeat
    }
  }

  return alerts
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * emitNotification — write a notification to the OpenClaw notification pipe.
 *
 * OpenClaw listens on stdout for lines prefixed with "NOTIFY:" and routes them
 * to the configured delivery target.  This is the lowest-common-denominator
 * integration that works across all hosting modes.
 */
function emitNotification(text: string): void {
  // Use structured log prefix that OpenClaw's log scanner picks up
  const payload = JSON.stringify({ type: 'jackclaw_notify', text, ts: Date.now() })
  process.stdout.write(`NOTIFY:${payload}\n`)
}
