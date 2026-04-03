// Hub routes — OrgNorm API
// GET    /api/org-norm          — 列出所有规范
// POST   /api/org-norm          — 添加规范（CEO only）
// DELETE /api/org-norm/:id      — 禁用规范（CEO only）

import { Router, Request, Response } from 'express'
import { getOrgNormStore } from '../store/org-norm'

const router = Router()
const store = getOrgNormStore()

/**
 * GET /api/org-norm
 * 可选 ?role=worker 按角色过滤（返回对该角色生效的启用规范）
 */
router.get('/', (req: Request, res: Response): void => {
  const { role } = req.query
  if (role && typeof role === 'string') {
    res.json({ norms: store.getActive(role) })
  } else {
    res.json({ norms: store.list() })
  }
})

/**
 * POST /api/org-norm
 * Body: { rule: string, scope: 'all'|'ceo'|'manager'|'worker' }
 * CEO only（JWT role 检查）
 */
router.post('/', (req: Request, res: Response): void => {
  const jwtPayload = req.jwtPayload
  if (!jwtPayload || jwtPayload.role !== 'ceo') {
    res.status(403).json({ error: 'Only CEO can create org norms' })
    return
  }

  const { rule, scope } = req.body as { rule?: string; scope?: string }
  if (!rule || typeof rule !== 'string' || rule.trim() === '') {
    res.status(400).json({ error: 'rule is required' })
    return
  }

  const validScopes = ['all', 'ceo', 'manager', 'worker']
  const normScope = (scope && validScopes.includes(scope) ? scope : 'all') as
    'all' | 'ceo' | 'manager' | 'worker'

  const norm = store.add(rule.trim(), normScope, jwtPayload.nodeId)
  res.status(201).json({ norm })
})

/**
 * DELETE /api/org-norm/:id
 * 禁用规范（软删除）— CEO only
 */
router.delete('/:id', (req: Request, res: Response): void => {
  const jwtPayload = req.jwtPayload
  if (!jwtPayload || jwtPayload.role !== 'ceo') {
    res.status(403).json({ error: 'Only CEO can disable org norms' })
    return
  }

  store.disable(req.params.id)
  res.json({ ok: true })
})

export default router
