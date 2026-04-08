/**
 * Audit Routes — /api/audit
 * 审计日志路由 —— /api/audit
 */

import { Router, Request, Response } from 'express'
import { auditStore, ApiAuditLogEntry } from '../store/audit-store'
import { asyncHandler } from '../server'
import { requireAdmin, getRequester } from './rbac-helpers'

const router = Router()

/**
 * POST /api/audit
 * Manually write one audit log.
 * SECURITY: only admin can write audit logs; userId bound from JWT
 */
router.post('/', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const adminId = requireAdmin(req, res)
  if (!adminId) return

  const body = (req.body ?? {}) as Record<string, unknown>

  const method = typeof body.method === 'string' ? body.method : 'MANUAL'
  const reqPath = typeof body.path === 'string' ? body.path : '/api/audit'
  const statusCode = typeof body.statusCode === 'number' ? body.statusCode : 200

  const entry: ApiAuditLogEntry = {
    tenantId: typeof body.tenantId === 'string' ? body.tenantId : undefined,
    userId: adminId, // SECURITY: always from JWT, never trust body
    method,
    path: reqPath,
    statusCode,
    result: statusCode < 400 ? 'success' : (statusCode === 403 ? 'rejected' : 'failure'),
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  }

  auditStore.log(entry)

  res.status(201).json({ success: true, entry })
}))

/**
 * GET /api/audit — SECURITY: admin only
 */
router.get('/', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return
  res.json({ success: true, message: 'Audit logs are append-only JSONL. Use POST to write.' })
}))

export default router
