/**
 * Route-level RBAC helpers for JWT-protected routes.
 * 
 * All routes behind jwtAuthMiddleware have req.jwtPayload available.
 * These helpers extract identity and enforce role/ownership checks.
 */

import type { Request, Response } from 'express'

interface JwtPayload {
  nodeId?: string
  handle?: string
  sub?: string
  role?: string
}

/** Extract requester identity from JWT payload */
export function getRequester(req: Request): string | null {
  const payload = (req as any).jwtPayload as JwtPayload | undefined
  return payload?.nodeId ?? payload?.handle ?? payload?.sub ?? null
}

/** Extract requester role from JWT payload */
export function getRole(req: Request): string {
  const payload = (req as any).jwtPayload as JwtPayload | undefined
  return (payload?.role ?? 'agent').toLowerCase()
}

/** Check if requester has admin/ceo/owner role */
export function isAdmin(req: Request): boolean {
  const role = getRole(req)
  return role === 'admin' || role === 'ceo' || role === 'owner'
}

/** Require authenticated requester, return 401 if missing */
export function requireAuth(req: Request, res: Response): string | null {
  const id = getRequester(req)
  if (!id) {
    res.status(401).json({ error: 'Unauthorized — JWT required' })
    return null
  }
  return id
}

/** Require admin role, return 403 if not admin */
export function requireAdmin(req: Request, res: Response): string | null {
  const id = requireAuth(req, res)
  if (!id) return null
  if (!isAdmin(req)) {
    res.status(403).json({ error: 'Forbidden — admin/ceo role required' })
    return null
  }
  return id
}
