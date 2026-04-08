"use strict";
/**
 * Route-level RBAC helpers for JWT-protected routes.
 *
 * All routes behind jwtAuthMiddleware have req.jwtPayload available.
 * These helpers extract identity and enforce role/ownership checks.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRequester = getRequester;
exports.getRole = getRole;
exports.isAdmin = isAdmin;
exports.requireAuth = requireAuth;
exports.requireAdmin = requireAdmin;
/** Extract requester identity from JWT payload */
function getRequester(req) {
    const payload = req.jwtPayload;
    return payload?.nodeId ?? payload?.handle ?? payload?.sub ?? null;
}
/** Extract requester role from JWT payload */
function getRole(req) {
    const payload = req.jwtPayload;
    return (payload?.role ?? 'agent').toLowerCase();
}
/** Check if requester has admin/ceo/owner role */
function isAdmin(req) {
    const role = getRole(req);
    return role === 'admin' || role === 'ceo' || role === 'owner';
}
/** Require authenticated requester, return 401 if missing */
function requireAuth(req, res) {
    const id = getRequester(req);
    if (!id) {
        res.status(401).json({ error: 'Unauthorized — JWT required' });
        return null;
    }
    return id;
}
/** Require admin role, return 403 if not admin */
function requireAdmin(req, res) {
    const id = requireAuth(req, res);
    if (!id)
        return null;
    if (!isAdmin(req)) {
        res.status(403).json({ error: 'Forbidden — admin/ceo role required' });
        return null;
    }
    return id;
}
//# sourceMappingURL=rbac-helpers.js.map