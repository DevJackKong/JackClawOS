/**
 * /api/members — Organization members routes / 组织成员路由
 *
 * POST   /        — Add a member to an org / 添加成员到组织
 * GET    /        — List org members / 列出组织成员
 * PATCH  /:id     — Update member role / 更新成员角色
 * DELETE /:id     — Remove member / 移除成员
 */

import { Router, Request, Response } from 'express'
import { memberStore } from '../store/member-store'
import { asyncHandler } from '../server'

const router = Router()

/**
 * POST /
 * Add a member to an organization.
 * 添加成员到指定组织。
 *
 * Body:
 * - tenantId: string
 * - orgId: string
 * - userId: string
 * - role: string
 */
router.post('/', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { tenantId, orgId, userId, role } = req.body as {
    tenantId?: string
    orgId?: string
    userId?: string
    role?: string
  }

  if (!tenantId || !orgId || !userId || !role) {
    res.status(400).json({ error: 'tenantId, orgId, userId, role required' })
    return
  }

  const existingMember = memberStore.getByUser(userId, tenantId)
  if (existingMember && existingMember.orgId === orgId) {
    res.status(409).json({ error: 'member_already_exists', member: existingMember })
    return
  }

  const member = memberStore.add(tenantId, orgId, userId, role)
  res.status(201).json({ status: 'ok', member })
}))

/**
 * GET /
 * List all members in one organization.
 * 列出某个组织下的全部成员。
 *
 * Query:
 * - orgId: string
 */
router.get('/', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const orgId = typeof req.query.orgId === 'string' ? req.query.orgId : undefined

  if (!orgId) {
    res.status(400).json({ error: 'orgId required' })
    return
  }

  const members = memberStore.listByOrg(orgId)
  res.json({ status: 'ok', members, count: members.length })
}))

/**
 * PATCH /:id
 * Update member role by member id.
 * 按成员 id 更新角色。
 *
 * Body:
 * - role: string
 */
router.patch('/:id', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params
  const { role } = req.body as { role?: string }

  if (!role) {
    res.status(400).json({ error: 'role required' })
    return
  }

  const member = memberStore.updateRole(id, role)
  if (!member) {
    res.status(404).json({ error: 'member_not_found' })
    return
  }

  res.json({ status: 'ok', member })
}))

/**
 * DELETE /:id
 * Remove a member by member id.
 * 按成员 id 移除成员。
 */
router.delete('/:id', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params
  const removed = memberStore.remove(id)

  if (!removed) {
    res.status(404).json({ error: 'member_not_found' })
    return
  }

  res.json({ status: 'ok', id })
}))

export default router
