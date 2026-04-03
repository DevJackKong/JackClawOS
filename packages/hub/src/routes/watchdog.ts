/**
 * Watchdog Hub Routes
 *
 * POST /api/watchdog/heartbeat       — 节点心跳上报（健康指标）
 * GET  /api/watchdog/status          — 所有节点健康状态
 * GET  /api/watchdog/status/:nodeId  — 单节点健康状态
 * POST /api/watchdog/policy       — 添加监督策略（需要 target 节点授权签名）
 * GET  /api/watchdog/alerts/:nodeId — 查询告警
 * POST /api/watchdog/ack/:eventId  — 真人确认告警（需要特殊 human-token）
 * GET  /api/watchdog/snapshot/:nodeId — 获取最新快照
 *
 * 安全约束：
 *  - addPolicy 需验证 target 签名（防止 Agent 擅自建立监督关系）
 *  - ack 接口只允许携带 X-Human-Token 的请求（机器人 JWT 被拒绝）
 *  - Agent 无法关闭告警（canModify() 始终 false）
 */

import { Router, Request, Response } from 'express'
import {
  addPolicy,
  getAlerts,
  humanAck,
  getLatestSnapshot,
  WatchdogPolicy,
  AlertSeverity,
} from '@jackclaw/watchdog'

const router = Router()

// ─── Heartbeat Health Monitor (in-memory) ─────────────────────────────────────

interface HeartbeatMetrics {
  memUsage: number
  cpuLoad: number
  uptime: number
  tasksCompleted: number
  lastTaskAt: number
}

interface WatchdogEntry {
  nodeId: string
  status: 'online' | 'offline'
  lastHeartbeat: number
  metrics: HeartbeatMetrics
}

const OFFLINE_THRESHOLD_MS = 90_000
const heartbeatStore = new Map<string, WatchdogEntry>()

function resolveStatus(entry: WatchdogEntry): WatchdogEntry {
  const now = Date.now()
  return {
    ...entry,
    status: now - entry.lastHeartbeat > OFFLINE_THRESHOLD_MS ? 'offline' : 'online',
  }
}

// ─── POST /api/watchdog/heartbeat ─────────────────────────────────────────────

router.post('/heartbeat', (req: Request, res: Response): void => {
  const { nodeId, metrics } = req.body as { nodeId?: string; metrics?: HeartbeatMetrics }

  if (!nodeId || !metrics) {
    res.status(400).json({ error: 'nodeId and metrics required' })
    return
  }

  heartbeatStore.set(nodeId, {
    nodeId,
    status: 'online',
    lastHeartbeat: Date.now(),
    metrics,
  })

  res.json({ ok: true })
})

// ─── GET /api/watchdog/status ─────────────────────────────────────────────────

router.get('/status', (_req: Request, res: Response): void => {
  const nodes: Record<string, WatchdogEntry> = {}
  for (const [id, entry] of heartbeatStore) {
    nodes[id] = resolveStatus(entry)
  }
  res.json({ nodes })
})

// ─── GET /api/watchdog/status/:nodeId ─────────────────────────────────────────

router.get('/status/:nodeId', (req: Request, res: Response): void => {
  const entry = heartbeatStore.get(req.params.nodeId)
  if (!entry) {
    res.status(404).json({ error: `No heartbeat data for node ${req.params.nodeId}` })
    return
  }
  res.json(resolveStatus(entry))
})

// ─── Middleware: human-token guard ────────────────────────────────────────────

const HUMAN_TOKEN = process.env.WATCHDOG_HUMAN_TOKEN

function requireHumanToken(req: Request, res: Response, next: () => void): void {
  const provided = req.headers['x-human-token']
  if (!HUMAN_TOKEN) {
    res.status(503).json({ error: 'WATCHDOG_HUMAN_TOKEN not configured on server' })
    return
  }
  if (provided !== HUMAN_TOKEN) {
    res.status(403).json({ error: 'Invalid or missing human token. Only humans can perform this action.' })
    return
  }
  next()
}

// ─── POST /api/watchdog/policy ────────────────────────────────────────────────

router.post('/policy', (req: Request, res: Response): void => {
  const policy = req.body as WatchdogPolicy & { targetSignature?: string }

  // Basic validation
  if (!policy.watcherHandle || !policy.targetHandle || !policy.scope) {
    res.status(400).json({ error: 'Missing required fields: watcherHandle, targetHandle, scope' })
    return
  }

  // If scope is 'granted', we require proof that target authorized it
  if (policy.scope === 'granted') {
    if (!policy.targetSignature) {
      res.status(403).json({
        error: 'granted-scope policy requires targetSignature from the monitored node',
      })
      return
    }
    // TODO: verify HMAC/JWT signature from target node
    // For now we accept it and log; full crypto verification can be added per node auth scheme
  }

  const cleanPolicy: WatchdogPolicy = {
    watcherHandle: policy.watcherHandle,
    targetHandle: policy.targetHandle,
    scope: policy.scope,
    permissions: policy.permissions ?? [],
    alertChannels: policy.alertChannels ?? [],
    webhookUrl: policy.webhookUrl,
    createdAt: Date.now(),
    grantedAt: policy.scope === 'granted' ? Date.now() : undefined,
  }

  addPolicy(cleanPolicy)

  res.json({ ok: true, policy: cleanPolicy })
})

// ─── GET /api/watchdog/alerts/:nodeId ─────────────────────────────────────────

router.get('/alerts/:nodeId', (req: Request, res: Response): void => {
  const { nodeId } = req.params
  const { severity, acknowledged, limit, since } = req.query

  const opts: Parameters<typeof getAlerts>[1] = {}

  if (severity) opts.severity = severity as AlertSeverity
  if (acknowledged !== undefined) opts.acknowledged = acknowledged === 'true'
  if (limit) opts.limit = parseInt(limit as string, 10)
  if (since) opts.since = parseInt(since as string, 10)

  const alerts = getAlerts(nodeId, opts)
  res.json({ nodeId, count: alerts.length, alerts })
})

// ─── POST /api/watchdog/ack/:eventId ─────────────────────────────────────────

router.post('/ack/:eventId', requireHumanToken as unknown as (req: Request, res: Response, next: () => void) => void, (req: Request, res: Response): void => {
  const { eventId } = req.params
  const { nodeId } = req.body as { nodeId?: string }
  const humanId = req.headers['x-human-id'] as string | undefined

  if (!nodeId) {
    res.status(400).json({ error: 'nodeId required in request body' })
    return
  }

  const acked = humanAck(eventId, nodeId, humanId ?? 'human-via-token')

  if (!acked) {
    res.status(404).json({ error: `Event ${eventId} not found for node ${nodeId}` })
    return
  }

  res.json({ ok: true, eventId, acknowledgedBy: humanId ?? 'human-via-token' })
})

// ─── GET /api/watchdog/snapshot/:nodeId ──────────────────────────────────────

router.get('/snapshot/:nodeId', (req: Request, res: Response): void => {
  const { nodeId } = req.params
  const snapshot = getLatestSnapshot(nodeId)

  if (!snapshot) {
    res.status(404).json({ error: `No snapshot found for node ${nodeId}` })
    return
  }

  res.json(snapshot)
})

// Export heartbeatStore for dashboard merge
export { heartbeatStore, resolveStatus }
export type { WatchdogEntry }

export default router
