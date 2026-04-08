// Hub routes - Config API
// GET    /api/config                  → 列出配置 / List config entries
// GET    /api/config/:key/effective   → 获取生效值 / Get effective config value
// GET    /api/config/:key             → 获取单个配置 / Get one config entry
// PUT    /api/config/:key             → 设置配置 / Set one config entry
// DELETE /api/config/:key             → 删除配置 / Delete one config entry

import { Router, Request, Response } from 'express'
import { configStore } from '../store/config-store'
import { asyncHandler } from '../server'

const router = Router()

type ApiScope = 'global' | 'tenant' | 'org' | 'user'
type StoreScope = 'system' | 'tenant' | 'org' | 'user'

type ConfigQuery = {
  scope?: string
  scopeId?: string
  tenantId?: string
  orgId?: string
  userId?: string
}

type PutConfigBody = {
  value?: unknown
  scope?: ApiScope
  scopeId?: string
  description?: string
}

/**
 * Validate API scope.
 * 校验 API 层 scope 参数是否合法。
 */
function isValidApiScope(scope: unknown): scope is ApiScope {
  return scope === undefined || scope === 'global' || scope === 'tenant' || scope === 'org' || scope === 'user'
}

/**
 * Convert API scope to store scope.
 * 将 API 的 global 映射为存储层的 system。
 */
function toStoreScope(scope?: string): StoreScope | undefined {
  if (scope === undefined) return undefined
  if (scope === 'global') return 'system'
  if (scope === 'tenant' || scope === 'org' || scope === 'user') return scope
  return undefined
}

/**
 * Read optional scope query.
 * 读取可选的 scope / scopeId 查询参数。
 */
function getScopeQuery(req: Request): { scope?: ApiScope; scopeId?: string } {
  const { scope, scopeId } = req.query as ConfigQuery
  return {
    scope: typeof scope === 'string' && scope.trim() ? scope.trim() as ApiScope : undefined,
    scopeId: typeof scopeId === 'string' && scopeId.trim() ? scopeId.trim() : undefined,
  }
}

/**
 * Resolve current operator id.
 * 解析当前操作者 ID，用于写入 updatedBy。
 */
function getUpdatedBy(req: Request): string | undefined {
  const operator = req.tenantContext?.userId
    ?? req.jwtPayload?.nodeId
    ?? req.jwtPayload?.role

  return typeof operator === 'string' && operator.trim() ? operator.trim() : undefined
}

/**
 * GET /
 * List config entries.
 * 列出配置，支持按 scope / scopeId 过滤。
 *
 * Query:
 * - scope?: global | tenant | org | user
 * - scopeId?: string
 */
router.get('/', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { scope, scopeId } = getScopeQuery(req)

  if (!isValidApiScope(scope)) {
    res.status(400).json({ error: 'Invalid scope. Must be global | tenant | org | user' })
    return
  }

  const configs = configStore.list(toStoreScope(scope), scopeId)
  res.json({ success: true, configs })
}))

/**
 * GET /:key/effective
 * Get effective config value by inheritance.
 * 获取最终生效配置值，优先级通常为 user > org > tenant > global。
 *
 * Note:
 * - Must be declared before `/:key`.
 * - 必须放在 `/:key` 路由前面。
 *
 * Query:
 * - tenantId?: string
 * - orgId?: string
 * - userId?: string
 */
router.get('/:key/effective', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const key = req.params.key?.trim()
  const { tenantId, orgId, userId } = req.query as ConfigQuery

  if (!key) {
    res.status(400).json({ error: 'key is required' })
    return
  }

  const effective = configStore.getEffective(
    key,
    typeof tenantId === 'string' && tenantId.trim() ? tenantId.trim() : undefined,
    typeof orgId === 'string' && orgId.trim() ? orgId.trim() : undefined,
    typeof userId === 'string' && userId.trim() ? userId.trim() : undefined,
  )

  if (effective === undefined) {
    res.status(404).json({ error: 'Config not found' })
    return
  }

  res.json({ success: true, key, effective })
}))

/**
 * GET /:key
 * Get one config value by key + exact scope.
 * 按 key + 精确作用域获取单个配置值。
 *
 * Query:
 * - scope?: global | tenant | org | user
 * - scopeId?: string
 */
router.get('/:key', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const key = req.params.key?.trim()
  const { scope, scopeId } = getScopeQuery(req)

  if (!key) {
    res.status(400).json({ error: 'key is required' })
    return
  }

  if (!isValidApiScope(scope)) {
    res.status(400).json({ error: 'Invalid scope. Must be global | tenant | org | user' })
    return
  }

  const config = configStore.get(key, toStoreScope(scope), scopeId)

  if (config === undefined) {
    res.status(404).json({ error: 'Config not found' })
    return
  }

  res.json({ success: true, key, config })
}))

/**
 * PUT /:key
 * Set one config value.
 * 设置单个配置。
 *
 * Body:
 * - value: unknown
 * - scope: global | tenant | org | user
 * - scopeId?: string
 * - description?: string
 *
 * Note:
 * - Current configStore.set signature is (key, value, scope, scopeId?, updatedBy?).
 * - description 字段当前仅做入参兼容，不会持久化到 store。
 */
router.put('/:key', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const key = req.params.key?.trim()
  const { value, scope = 'global', scopeId, description } = (req.body ?? {}) as PutConfigBody

  if (!key) {
    res.status(400).json({ error: 'key is required' })
    return
  }

  if (!isValidApiScope(scope)) {
    res.status(400).json({ error: 'Invalid scope. Must be global | tenant | org | user' })
    return
  }

  if (scope !== 'global' && (!scopeId || typeof scopeId !== 'string' || !scopeId.trim())) {
    res.status(400).json({ error: 'scopeId is required when scope is tenant | org | user' })
    return
  }

  if (description !== undefined && typeof description !== 'string') {
    res.status(400).json({ error: 'description must be a string' })
    return
  }

  const config = configStore.set(
    key,
    value,
    toStoreScope(scope) as StoreScope,
    scope === 'global' ? undefined : scopeId?.trim(),
    getUpdatedBy(req),
  )

  res.json({
    success: true,
    config,
    ...(description !== undefined ? { note: 'description accepted but not persisted by current configStore.set signature' } : {}),
  })
}))

/**
 * DELETE /:key
 * Delete one config value.
 * 删除单个配置。
 *
 * Query:
 * - scope?: global | tenant | org | user
 * - scopeId?: string
 */
router.delete('/:key', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const key = req.params.key?.trim()
  const { scope = 'global', scopeId } = getScopeQuery(req)

  if (!key) {
    res.status(400).json({ error: 'key is required' })
    return
  }

  if (!isValidApiScope(scope)) {
    res.status(400).json({ error: 'Invalid scope. Must be global | tenant | org | user' })
    return
  }

  if (scope !== 'global' && !scopeId) {
    res.status(400).json({ error: 'scopeId is required when scope is tenant | org | user' })
    return
  }

  const deleted = configStore.delete(
    key,
    toStoreScope(scope),
    scope === 'global' ? undefined : scopeId,
  )

  if (!deleted) {
    res.status(404).json({ error: 'Config not found' })
    return
  }

  res.json({ success: true, deleted: true })
}))

export default router
