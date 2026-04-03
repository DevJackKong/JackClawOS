/**
 * OwnerMemory 授权区路由
 *
 * 主人视角（无需 token）：
 *   GET  /api/owner/snapshot      — 情绪快照
 *   GET  /api/owner/stats         — 关系统计
 *   GET  /api/owner/auth/pending  — 待审批申请
 *   POST /api/owner/auth/approve  — 批准申请
 *   POST /api/owner/auth/revoke   — 撤销授权
 *   GET  /api/owner/auth/grants   — 所有有效授权
 *   GET  /api/owner/auth/audit    — 访问日志
 *
 * 第三方产品侧：
 *   POST /api/owner/auth/request  — 申请授权
 *   POST /api/owner/auth/token    — 换取 access token
 *   GET  /api/owner/data/:scope   — 用 token 读取授权数据
 */

import { Router, Request, Response } from 'express'
import type { NodeIdentity } from '@jackclaw/protocol'
import { getOwnerMemoryAuth } from '../owner-memory-auth'
import { getOwnerMemory } from '../owner-memory'
import type { AccessScope, AuthRequest } from '../owner-memory-auth'

export function createOwnerAuthRouter(identity: NodeIdentity): Router {
  const router = Router()
  const auth = getOwnerMemoryAuth(identity.nodeId)
  const memory = getOwnerMemory(identity.nodeId)

  // ── 主人视角：memory 只读 ──────────────────────────────────────────────────

  // GET /api/owner/snapshot — 情绪快照（主人自查，无需授权）
  router.get('/snapshot', (_req: Request, res: Response) => {
    res.json(memory.getEmotionSnapshot())
  })

  // GET /api/owner/stats — 关系统计（主人自查，无需授权）
  router.get('/stats', (_req: Request, res: Response) => {
    res.json(memory.getStats())
  })

  // ── 主人视角：授权管理 ────────────────────────────────────────────────────

  // GET /api/owner/auth/pending — 查看待审批的授权申请
  router.get('/auth/pending', (_req: Request, res: Response) => {
    res.json(auth.getPendingRequests())
  })

  // POST /api/owner/auth/approve — 批准授权申请
  // body: { requestId, scopes?: AccessScope[], expiryDays?: number, userNote?: string }
  router.post('/auth/approve', (req: Request, res: Response) => {
    const { requestId, scopes, expiryDays, userNote } = req.body ?? {}
    if (!requestId) {
      res.status(400).json({ error: 'requestId is required' })
      return
    }
    try {
      const grant = auth.approve(requestId, { scopes, expiryDays, userNote })
      res.json({ grant })
    } catch (err: any) {
      res.status(400).json({ error: err.message })
    }
  })

  // POST /api/owner/auth/revoke — 撤销授权
  // body: { grantId }
  router.post('/auth/revoke', (req: Request, res: Response) => {
    const { grantId } = req.body ?? {}
    if (!grantId) {
      res.status(400).json({ error: 'grantId is required' })
      return
    }
    try {
      auth.revoke(grantId)
      res.json({ ok: true, grantId })
    } catch (err: any) {
      res.status(400).json({ error: err.message })
    }
  })

  // GET /api/owner/auth/grants — 列出所有有效授权
  router.get('/auth/grants', (_req: Request, res: Response) => {
    res.json(auth.listGrants())
  })

  // GET /api/owner/auth/audit — 查看访问日志（可选 ?grantId=xxx 过滤）
  router.get('/auth/audit', (req: Request, res: Response) => {
    const grantId = req.query.grantId as string | undefined
    res.json(auth.getAuditLog(grantId))
  })

  // ── 第三方产品侧 ──────────────────────────────────────────────────────────

  // POST /api/owner/auth/request — 申请授权
  // body: { clientId, clientName, productType, requestedScopes, reason, webhookUrl? }
  router.post('/auth/request', (req: Request, res: Response) => {
    const { clientId, clientName, productType, requestedScopes, reason, webhookUrl } = req.body ?? {}
    if (!clientId || !clientName || !productType || !requestedScopes || !reason) {
      res.status(400).json({ error: 'clientId, clientName, productType, requestedScopes, reason are required' })
      return
    }
    try {
      const request: AuthRequest = { clientId, clientName, productType, requestedScopes, reason, webhookUrl }
      const requestId = auth.requestAccess(request)
      res.json({ requestId, status: 'pending' })
    } catch (err: any) {
      res.status(400).json({ error: err.message })
    }
  })

  // POST /api/owner/auth/token — 用 grantId + clientSecret 换取 access token
  // body: { grantId, clientSecret }
  router.post('/auth/token', (req: Request, res: Response) => {
    const { grantId, clientSecret } = req.body ?? {}
    if (!grantId || !clientSecret) {
      res.status(400).json({ error: 'grantId and clientSecret are required' })
      return
    }
    try {
      const token = auth.issueToken(grantId, clientSecret)
      res.json(token)
    } catch (err: any) {
      res.status(401).json({ error: err.message })
    }
  })

  // GET /api/owner/data/:scope — 读取授权数据（需要 Bearer token）
  // Header: Authorization: Bearer <token>
  router.get('/data/:scope', (req: Request, res: Response) => {
    const authHeader = req.headers.authorization ?? ''
    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authorization: Bearer <token> required' })
      return
    }
    const token = authHeader.slice(7)
    const scope = req.params.scope as AccessScope

    try {
      const entries = memory.get()
      const data = auth.access(token, scope, entries)
      res.json({ scope, data })
    } catch (err: any) {
      const status = err.message.includes('Token') || err.message.includes('Grant') ? 401 : 403
      res.status(status).json({ error: err.message })
    }
  })

  return router
}
