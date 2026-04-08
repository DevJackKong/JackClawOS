/**
 * Interaction Trace Routes — /api/traces
 * 交互追踪路由 —— /api/traces
 *
 * GET    /api/traces            — Query trace entries / 查询 trace 列表
 * GET    /api/traces/:id        — Get one trace entry / 获取单个 trace
 * GET    /api/traces/:id/chain  — Get full delegation chain / 获取完整委派链
 * POST   /api/traces            — Create a manual trace entry / 手动创建 trace 记录
 */

import { Router, Request, Response } from 'express'
import { traceStore, TraceEntry } from '../store/trace-store'
import { asyncHandler } from '../server'

const router = Router()

/**
 * Parse number-like query value safely.
 * 安全解析数字类型 query 参数。
 */
function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Parse positive limit with a sane upper bound.
 * 解析 limit，并加一个合理上限避免一次返回过多数据。
 */
function parseLimit(value: unknown): number | undefined {
  const parsed = parseOptionalNumber(value)
  if (parsed === undefined) return undefined
  if (parsed <= 0) return undefined
  return Math.min(Math.floor(parsed), 200)
}

/**
 * GET /
 * Query traces with structured filters.
 * 按条件查询 traces。
 *
 * Query params:
 * - tenantId
 * - type
 * - action
 * - actorId
 * - targetId
 * - from
 * - to
 * - limit
 */
router.get('/', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const tenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId.trim() : undefined
  const type = typeof req.query.type === 'string' ? req.query.type.trim() : undefined
  const action = typeof req.query.action === 'string' ? req.query.action.trim() : undefined
  const actorId = typeof req.query.actorId === 'string' ? req.query.actorId.trim() : undefined
  const targetId = typeof req.query.targetId === 'string' ? req.query.targetId.trim() : undefined
  const from = parseOptionalNumber(req.query.from)
  const to = parseOptionalNumber(req.query.to)
  const limit = parseLimit(req.query.limit)

  let traces = traceStore.search({ tenantId, type, action, from, to }, limit)

  // Extra filters not covered by traceStore.search().
  // traceStore.search() 未覆盖的额外过滤条件。
  if (actorId) {
    traces = traces.filter(trace => trace.actorId === actorId)
  }

  if (targetId) {
    traces = traces.filter(trace => trace.targetId === targetId)
  }

  res.json({
    success: true,
    filters: { tenantId, type, action, actorId, targetId, from, to, limit },
    count: traces.length,
    traces,
  })
}))

/**
 * GET /:id
 * Get one trace entry by id.
 * 按 id 获取单条 trace。
 */
router.get('/:id', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const trace = traceStore.get(req.params.id)

  if (!trace) {
    res.status(404).json({ error: 'trace_not_found' })
    return
  }

  res.json({ success: true, trace })
}))

/**
 * GET /:id/chain
 * Get the full parent delegation chain of one trace.
 * 获取某条 trace 的完整父级委派链。
 */
router.get('/:id/chain', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const trace = traceStore.get(req.params.id)

  if (!trace) {
    res.status(404).json({ error: 'trace_not_found' })
    return
  }

  const chain = traceStore.getChain(req.params.id)
  res.json({
    success: true,
    traceId: req.params.id,
    count: chain.length,
    chain,
  })
}))

/**
 * POST /
 * Manually create a trace entry.
 * 手动创建一条 trace 记录。
 *
 * Body:
 * - tenantId: string
 * - type: TraceEntry['type']
 * - action: string
 * - actorId: string
 * - targetId?: string
 * - parentTraceId?: string
 * - metadata?: Record<string, unknown>
 */
router.post('/', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const {
    tenantId,
    type,
    action,
    actorId,
    targetId,
    parentTraceId,
    metadata,
  } = req.body as Partial<Omit<TraceEntry, 'id' | 'timestamp'>>

  if (!tenantId || !type || !action || !actorId) {
    res.status(400).json({
      error: 'tenantId, type, action, actorId required',
    })
    return
  }

  const allowedTypes: TraceEntry['type'][] = ['message', 'task', 'approval', 'memory', 'delegation', 'system']
  if (!allowedTypes.includes(type)) {
    res.status(400).json({
      error: 'invalid trace type',
      allowedTypes,
    })
    return
  }

  if (parentTraceId && !traceStore.get(parentTraceId)) {
    res.status(400).json({ error: 'parent_trace_not_found' })
    return
  }

  const trace = traceStore.add({
    tenantId,
    type,
    action,
    actorId,
    targetId,
    parentTraceId,
    metadata: metadata && typeof metadata === 'object' ? metadata : undefined,
  })

  res.status(201).json({ success: true, trace })
}))

export default router
