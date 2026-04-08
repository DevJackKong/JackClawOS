/**
 * Route-level RBAC helpers for JWT-protected routes.
 *
 * All routes behind jwtAuthMiddleware have req.jwtPayload available.
 * These helpers extract identity and enforce role/ownership checks.
 */
import type { Request, Response } from 'express';
/** Extract requester identity from JWT payload */
export declare function getRequester(req: Request): string | null;
/** Extract requester role from JWT payload */
export declare function getRole(req: Request): string;
/** Check if requester has admin/ceo/owner role */
export declare function isAdmin(req: Request): boolean;
/** Require authenticated requester, return 401 if missing */
export declare function requireAuth(req: Request, res: Response): string | null;
/** Require admin role, return 403 if not admin */
export declare function requireAdmin(req: Request, res: Response): string | null;
//# sourceMappingURL=rbac-helpers.d.ts.map