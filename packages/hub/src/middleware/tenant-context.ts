import type { NextFunction, Request, RequestHandler, Response } from 'express'
import jwt from 'jsonwebtoken'
import type { TenantContext } from '../types'

/**
 * JWT payload shape used by tenant context middleware.
 * tenant / org 字段做宽松兼容，便于兼容不同 token 结构。
 */
type TenantAwareJwtPayload = {
  tenantId?: string
  tenant_id?: string
  orgId?: string
  org_id?: string
  organizationId?: string
  organization_id?: string
  userId?: string
  user_id?: string
  nodeId?: string
  sub?: string
  handle?: string
  role?: string
  [key: string]: unknown
}

/**
 * Middleware options.
 * 中间件配置项。
 */
export interface TenantContextMiddlewareOptions {
  requireTenant?: boolean
}

/**
 * Extract Bearer token from Authorization header.
 */
function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return null
  return authHeader.slice(7).trim() || null
}

/**
 * Best-effort read JWT payload.
 */
function getJwtPayload(req: Request): TenantAwareJwtPayload | undefined {
  if (req.jwtPayload && typeof req.jwtPayload === 'object') {
    return req.jwtPayload as TenantAwareJwtPayload
  }

  const token = getBearerToken(req)
  if (!token) return undefined

  const decoded = jwt.decode(token)
  if (!decoded || typeof decoded !== 'object') return undefined
  return decoded as TenantAwareJwtPayload
}

function readHeaderString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]?.trim() || undefined
  if (typeof value === 'string') return value.trim() || undefined
  return undefined
}

function resolveTenantContext(req: Request): TenantContext {
  const payload = getJwtPayload(req)
  const tenantIdFromHeader = readHeaderString(req.header('X-Tenant-Id') ?? undefined)

  const tenantId = tenantIdFromHeader
    ?? payload?.tenantId
    ?? payload?.tenant_id
    ?? ''

  const orgId = payload?.orgId
    ?? payload?.org_id
    ?? payload?.organizationId
    ?? payload?.organization_id

  const userId = payload?.userId
    ?? payload?.user_id
    ?? payload?.nodeId
    ?? payload?.sub
    ?? payload?.handle
    ?? ''

  const role = payload?.role ?? ''

  return { tenantId, orgId, userId, role }
}

/**
 * Express middleware factory for tenant context.
 */
export function tenantContextMiddleware(options: TenantContextMiddlewareOptions = {}): RequestHandler {
  const { requireTenant = false } = options

  return (req: Request, res: Response, next: NextFunction): void => {
    req.tenantContext = resolveTenantContext(req)

    if (requireTenant && !req.tenantContext.tenantId) {
      res.status(403).json({
        error: 'Tenant access denied',
        code: 'TENANT_REQUIRED',
        message: 'This request requires a tenantId.',
      })
      return
    }

    next()
  }
}

export default tenantContextMiddleware
