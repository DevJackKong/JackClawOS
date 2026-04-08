/**
 * Audit Routes — /api/audit
 * 审计日志路由 —— /api/audit
 */

import { Router, Request, Response } from 'express'
import { auditStore, ApiAuditLogEntry } from '../store/audit-store'
import { asyncHandler } from '../server'

const router = Router()

/**
 * POST /api/audit
 * Manually write one audit log.
 * 手动写入一条审计日志。
 */
router.post('/', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>

  const method = typeof body.method === 'string' ? body.method : 'MANUAL'
  const reqPath = typeof body.path === 'string' ? body.path : '/api/audit'
  const statusCode = typeof body.statusCode === 'number' ? body.statusCode : 200

  const entry: ApiAuditLogEntry = {
    tenantId: typeof body.tenantId === 'string' ? body.tenantId : undefined,
    userId: typeof body.userId === 'string' ? body.userId : undefined,
    method,
    path: reqPath,
    statusCode,
    result: statusCode < 400 ? 'success' : (statusCode === 403 ? 'rejected' : 'failure'),
    ip: typeof body.ip === 'string' ? body.ip : req.ip,
    userAgent: typeof body.userAgent === 'string' ? body.userAgent : req.headers['user-agent'],
  }

  auditStore.log(entry)

  res.status(201).json({ success: true, entry })
}))

/**
 * GET /api/audit
 * List recent audit logs (read from JSONL).
 * 列出最近的审计日志。
 */
router.get('/', asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  // auditStore 是 append-only JSONL，目前不提供 query 方法
  // 返回提示信息
  res.json({ success: true, message: 'Audit logs are append-only JSONL. Use POST to write.' })
}))

export default router
