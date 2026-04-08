import { Router, Request, Response } from 'express'
import { approvalStore } from '../store/approval-store'
import { asyncHandler } from '../server'

const router = Router()

type ApprovalState = 'pending' | 'approved' | 'rejected' | 'expired'

type CreateApprovalBody = {
  tenantId?: string
  type?: string
  title?: string
  description?: string
  requestedBy?: string
  payload?: Record<string, unknown>
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

type ApproveApprovalBody = {
  approvedBy?: string
  reason?: string
}

type RejectApprovalBody = {
  rejectedBy?: string
  reason?: string
}

type ApprovalListQuery = {
  tenantId?: string
  state?: ApprovalState
  requestedBy?: string
  limit?: string
}

type ApprovalStoreLike = {
  create?: (...args: any[]) => any
  list?: (...args: any[]) => any
  get?: (...args: any[]) => any
  pending?: (...args: any[]) => any
  listPending?: (...args: any[]) => any
  getPending?: (...args: any[]) => any
  approve?: (...args: any[]) => any
  reject?: (...args: any[]) => any
}

const store = approvalStore as ApprovalStoreLike

/**
 * Parse and validate numeric limit.
 * 解析并校验 limit 参数。
 */
function parseLimit(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw Object.assign(new Error('limit must be a positive number / limit 必须为正数'), { status: 400 })
  }
  return Math.floor(parsed)
}

/**
 * Validate approval state.
 * 校验审批状态。
 */
function isValidState(value: unknown): value is ApprovalState {
  return value === 'pending' || value === 'approved' || value === 'rejected' || value === 'expired'
}

/**
 * Safely invoke a store method.
 * 安全调用 store 方法；若方法不存在则抛出明确错误。
 */
function callStore(methodNames: string[], ...args: any[]): any {
  for (const methodName of methodNames) {
    const fn = (store as Record<string, unknown>)[methodName]
    if (typeof fn === 'function') {
      return (fn as (...innerArgs: any[]) => any).call(store, ...args)
    }
  }

  throw Object.assign(
    new Error(`approvalStore method not found: ${methodNames.join(' | ')}`),
    { status: 500 },
  )
}

/**
 * POST /api/approvals
 * Create an approval request.
 * 创建审批请求。
 */
router.post('/', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const body = (req.body ?? {}) as CreateApprovalBody

  if (!body.tenantId || typeof body.tenantId !== 'string' || !body.tenantId.trim()) {
    res.status(400).json({ error: 'tenantId is required / tenantId 必填' })
    return
  }

  if (!body.requestedBy || typeof body.requestedBy !== 'string' || !body.requestedBy.trim()) {
    res.status(400).json({ error: 'requestedBy is required / requestedBy 必填' })
    return
  }

  const approval = callStore(
    ['create'],
    body.tenantId!.trim(),
    (body.type as string || 'general').trim(),
    (body.title as string || 'Untitled').trim(),
    body.requestedBy!.trim(),
    body,
  )
  res.status(201).json({ success: true, approval })
}))

/**
 * GET /api/approvals
 * List approvals with optional filters.
 * 列出审批，支持可选筛选条件。
 *
 * Query:
 * - tenantId
 * - state
 * - requestedBy
 * - limit
 */
router.get('/', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { tenantId, state, requestedBy, limit } = req.query as ApprovalListQuery

  if (state !== undefined && !isValidState(state)) {
    res.status(400).json({ error: 'invalid state / state 非法' })
    return
  }

  const parsedLimit = parseLimit(limit)
  const filters = {
    ...(tenantId ? { tenantId } : {}),
    ...(state ? { state } : {}),
    ...(requestedBy ? { requestedBy } : {}),
    ...(parsedLimit !== undefined ? { limit: parsedLimit } : {}),
  }

  const approvals = callStore(['list'], tenantId ?? '', filters)
  const count = Array.isArray(approvals) ? approvals.length : undefined

  res.json({ success: true, approvals, ...(count !== undefined ? { count } : {}) })
}))

/**
 * GET /api/approvals/pending
 * List all pending approvals.
 * 列出待审批项。
 */
router.get('/pending', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const tenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined
  const requestedBy = typeof req.query.requestedBy === 'string' ? req.query.requestedBy : undefined
  const parsedLimit = parseLimit(req.query.limit)

  const filters = {
    ...(tenantId ? { tenantId } : {}),
    ...(requestedBy ? { requestedBy } : {}),
    ...(parsedLimit !== undefined ? { limit: parsedLimit } : {}),
    state: 'pending' as const,
  }

  const approvals = callStore(['list'], tenantId ?? '', filters)
  const count = Array.isArray(approvals) ? approvals.length : undefined

  res.json({ success: true, approvals, ...(count !== undefined ? { count } : {}) })
}))

/**
 * GET /api/approvals/:id
 * Get a single approval by id.
 * 获取单个审批详情。
 */
router.get('/:id', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const approval = callStore(['get'], req.params.id)

  if (!approval) {
    res.status(404).json({ error: 'approval not found / 审批不存在' })
    return
  }

  res.json({ success: true, approval })
}))

/**
 * POST /api/approvals/:id/approve
 * Approve an approval request.
 * 批准一个审批请求。
 *
 * Body:
 * - approvedBy: string
 * - reason?: string
 */
router.post('/:id/approve', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { approvedBy, reason } = (req.body ?? {}) as ApproveApprovalBody

  if (!approvedBy || typeof approvedBy !== 'string' || !approvedBy.trim()) {
    res.status(400).json({ error: 'approvedBy is required / approvedBy 必填' })
    return
  }

  const approval = callStore(['approve'], req.params.id, approvedBy, reason)

  if (!approval) {
    res.status(404).json({ error: 'approval not found / 审批不存在' })
    return
  }

  res.json({ success: true, approval })
}))

/**
 * POST /api/approvals/:id/reject
 * Reject an approval request.
 * 拒绝一个审批请求。
 *
 * Body:
 * - rejectedBy: string
 * - reason?: string
 */
router.post('/:id/reject', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { rejectedBy, reason } = (req.body ?? {}) as RejectApprovalBody

  if (!rejectedBy || typeof rejectedBy !== 'string' || !rejectedBy.trim()) {
    res.status(400).json({ error: 'rejectedBy is required / rejectedBy 必填' })
    return
  }

  const approval = callStore(['reject'], req.params.id, rejectedBy, reason)

  if (!approval) {
    res.status(404).json({ error: 'approval not found / 审批不存在' })
    return
  }

  res.json({ success: true, approval })
}))

export default router
