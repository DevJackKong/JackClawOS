// Hub routes — Workspace API
// POST   /api/workspace        — 创建 workspace / Create workspace
// GET    /api/workspace        — 列出当前 org 下的 workspaces / List workspaces in current org
// GET    /api/workspace/:id    — 获取单个 workspace / Get one workspace
// PATCH  /api/workspace/:id    — 更新 workspace / Update workspace
// DELETE /api/workspace/:id    — 删除 workspace / Delete workspace

import { Router, Request, Response } from 'express'
import { workspaceStore } from '../store/workspace-store'
import { asyncHandler } from '../server'

const router = Router()

/**
 * 从请求上下文解析当前组织与租户。
 * Resolve current org/tenant from request context.
 */
function getScope(req: Request): { orgId?: string; tenantId?: string } {
  const orgId = req.tenantContext?.orgId
    ?? (req.jwtPayload as Record<string, unknown> | undefined)?.orgId as string | undefined
    ?? (req.jwtPayload as Record<string, unknown> | undefined)?.org_id as string | undefined

  const tenantId = req.tenantContext?.tenantId
    ?? (req.jwtPayload as Record<string, unknown> | undefined)?.tenantId as string | undefined
    ?? (req.jwtPayload as Record<string, unknown> | undefined)?.tenant_id as string | undefined

  return { orgId, tenantId }
}

/**
 * 校验 workspace 是否属于当前 org。
 * Ensure the workspace belongs to current org.
 */
function ensureWorkspaceInOrg(id: string, orgId: string) {
  const workspace = workspaceStore.get(id)
  if (!workspace) return { error: 'workspace_not_found' as const }
  if (workspace.orgId !== orgId) return { error: 'workspace_forbidden' as const }
  return { workspace }
}

/**
 * POST /
 * 创建 workspace。
 * Create a workspace under current org.
 */
router.post('/', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { orgId, tenantId } = getScope(req)
  if (!orgId) {
    res.status(400).json({ error: 'orgId required in request context' })
    return
  }
  if (!tenantId) {
    res.status(400).json({ error: 'tenantId required in request context' })
    return
  }

  const { name, slug } = req.body as { name?: string; slug?: string }
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  if (!slug || typeof slug !== 'string' || !slug.trim()) {
    res.status(400).json({ error: 'slug is required' })
    return
  }

  const workspace = workspaceStore.create(orgId, tenantId, name, slug)
  res.status(201).json({ workspace })
}))

/**
 * GET /
 * 列出当前 org 下的所有 workspace。
 * List all workspaces in current org.
 */
router.get('/', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { orgId } = getScope(req)
  if (!orgId) {
    res.status(400).json({ error: 'orgId required in request context' })
    return
  }

  const workspaces = workspaceStore.listByOrg(orgId)
  res.json({ workspaces, count: workspaces.length })
}))

/**
 * GET /:id
 * 获取当前 org 下的单个 workspace。
 * Get a single workspace in current org.
 */
router.get('/:id', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { orgId } = getScope(req)
  if (!orgId) {
    res.status(400).json({ error: 'orgId required in request context' })
    return
  }

  const result = ensureWorkspaceInOrg(req.params.id, orgId)
  if ('error' in result) {
    res.status(result.error === 'workspace_not_found' ? 404 : 403).json({ error: result.error })
    return
  }

  res.json({ workspace: result.workspace })
}))

/**
 * PATCH /:id
 * 更新当前 org 下的 workspace。
 * Update a workspace in current org.
 */
router.patch('/:id', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { orgId } = getScope(req)
  if (!orgId) {
    res.status(400).json({ error: 'orgId required in request context' })
    return
  }

  const result = ensureWorkspaceInOrg(req.params.id, orgId)
  if ('error' in result) {
    res.status(result.error === 'workspace_not_found' ? 404 : 403).json({ error: result.error })
    return
  }

  const { name, slug } = req.body as { name?: string; slug?: string }
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    res.status(400).json({ error: 'name must be a non-empty string' })
    return
  }
  if (slug !== undefined && (typeof slug !== 'string' || !slug.trim())) {
    res.status(400).json({ error: 'slug must be a non-empty string' })
    return
  }

  const workspace = workspaceStore.update(req.params.id, { name, slug })
  res.json({ workspace })
}))

/**
 * DELETE /:id
 * 删除当前 org 下的 workspace。
 * Delete a workspace in current org.
 */
router.delete('/:id', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { orgId } = getScope(req)
  if (!orgId) {
    res.status(400).json({ error: 'orgId required in request context' })
    return
  }

  const result = ensureWorkspaceInOrg(req.params.id, orgId)
  if ('error' in result) {
    res.status(result.error === 'workspace_not_found' ? 404 : 403).json({ error: result.error })
    return
  }

  workspaceStore.delete(req.params.id)
  res.json({ ok: true })
}))

export default router
