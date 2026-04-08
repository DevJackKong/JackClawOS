/**
 * /api/task-state — Task state routes / 任务状态路由
 *
 * POST   /                — Create task / 创建任务
 * GET    /                — List tasks / 列出任务
 * GET    /:id             — Get one task / 获取单个任务
 * PATCH  /:id             — Update task metadata / 更新任务元数据
 * POST   /:id/transition  — Transition task state / 执行状态转换
 * POST   /:id/assign      — Assign task / 分配任务
 * GET    /:id/history     — Get transition history / 获取状态变更历史
 */

import { Router, Request, Response } from 'express'
import { taskStateStore } from '../store/task-state-store'
import { asyncHandler } from '../server'

const router = Router()

/**
 * Store method surface used by this router.
 * 路由依赖的 store 方法集合。
 *
 * Note:
 * - Use a narrowed runtime shape to reduce coupling with store internals.
 * - 用最小方法集合约束，降低与 store 内部实现的耦合。
 */
type TaskStateStoreLike = {
  create: (tenantId: string, title: string, creatorId: string, opts?: Record<string, unknown>) => unknown | Promise<unknown>
  list: (tenantId: string, opts?: Record<string, unknown>) => unknown | Promise<unknown>
  get: (id: string) => unknown | Promise<unknown>
  update: (id: string, patch: Record<string, unknown>) => unknown | Promise<unknown>
  transition: (id: string, event: string, actorId?: string) => unknown | Promise<unknown>
  assign: (id: string, assigneeId: string, actorId?: string) => unknown | Promise<unknown>
}

const store = taskStateStore as unknown as TaskStateStoreLike

/**
 * Parse positive integer query safely.
 * 安全解析正整数 query 参数。
 */
function parseLimit(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return parsed
}

/**
 * Normalize not-found style responses.
 * 统一处理“资源不存在”响应。
 */
function sendNotFound(res: Response, message = 'task_not_found'): void {
  res.status(404).json({ error: message })
}

/**
 * POST /
 * Create a task.
 * 创建一个任务。
 */
router.post('/', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const payload = (req.body ?? {}) as Record<string, unknown>
  const tenantId = (payload.tenantId as string || req.tenantContext?.tenantId || '').trim()
  const title = (payload.title as string || '').trim()
  const creatorId = (payload.creatorId as string || req.tenantContext?.userId || '').trim()

  if (!tenantId) {
    res.status(400).json({ error: 'tenantId is required' })
    return
  }
  if (!title) {
    res.status(400).json({ error: 'title is required' })
    return
  }
  if (!creatorId) {
    res.status(400).json({ error: 'creatorId is required' })
    return
  }

  const task = await store.create(tenantId, title, creatorId, payload as any)
  res.status(201).json({ task })
}))

/**
 * GET /
 * List tasks with optional filters.
 * 按可选过滤条件列出任务。
 *
 * Query:
 * - tenantId?: string
 * - state?: string
 * - assigneeId?: string
 * - limit?: number
 */
router.get('/', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const tenantId = (typeof req.query.tenantId === 'string' ? req.query.tenantId : req.tenantContext?.tenantId) || ''
  const state = typeof req.query.state === 'string' ? req.query.state : undefined
  const assigneeId = typeof req.query.assigneeId === 'string' ? req.query.assigneeId : undefined
  const limit = parseLimit(req.query.limit)

  if (!tenantId) {
    res.status(400).json({ error: 'tenantId is required' })
    return
  }

  const tasks = await store.list(tenantId, {
    ...(state ? { state } : {}),
    ...(assigneeId ? { assigneeId } : {}),
    ...(limit ? { limit } : {}),
  })

  res.json({ tasks })
}))

/**
 * GET /:id
 * Get one task by id.
 * 按 id 获取单个任务。
 */
router.get('/:id', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const task = await store.get(req.params.id)
  if (!task) {
    sendNotFound(res)
    return
  }

  res.json({ task })
}))

/**
 * PATCH /:id
 * Update task metadata.
 * 更新任务元数据。
 */
router.patch('/:id', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const patch = (req.body ?? {}) as Record<string, unknown>
  const task = await store.update(req.params.id, patch)

  if (!task) {
    sendNotFound(res)
    return
  }

  res.json({ task })
}))

/**
 * POST /:id/transition
 * Transition task state.
 * 执行任务状态流转。
 *
 * Body:
 * - event: string
 * - actorId?: string
 */
router.post('/:id/transition', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { event, actorId } = (req.body ?? {}) as {
    event?: string
    actorId?: string
  }

  if (!event || typeof event !== 'string' || !event.trim()) {
    res.status(400).json({ error: 'event is required' })
    return
  }

  const task = await store.transition(req.params.id, event, actorId)
  if (!task) {
    sendNotFound(res)
    return
  }

  res.json({ task })
}))

/**
 * POST /:id/assign
 * Assign task to a user.
 * 给任务分配处理人。
 *
 * Body:
 * - assigneeId: string
 * - actorId?: string
 */
router.post('/:id/assign', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { assigneeId, actorId } = (req.body ?? {}) as {
    assigneeId?: string
    actorId?: string
  }

  if (!assigneeId || typeof assigneeId !== 'string' || !assigneeId.trim()) {
    res.status(400).json({ error: 'assigneeId is required' })
    return
  }

  const task = await store.assign(req.params.id, assigneeId, actorId)
  if (!task) {
    sendNotFound(res)
    return
  }

  res.json({ task })
}))

/**
 * GET /:id/history
 * Get task transition history.
 * 获取任务状态变更历史。
 */
router.get('/:id/history', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const task = await store.get(req.params.id) as { stateHistory?: unknown[] } | null
  if (!task) {
    sendNotFound(res)
    return
  }

  res.json({ history: task.stateHistory ?? [] })
}))

export default router
