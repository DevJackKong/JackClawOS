"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tenantContextMiddleware = tenantContextMiddleware;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
/**
 * Extract Bearer token from Authorization header.
 */
function getBearerToken(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer '))
        return null;
    return authHeader.slice(7).trim() || null;
}
/**
 * Best-effort read JWT payload.
 */
function getJwtPayload(req) {
    if (req.jwtPayload && typeof req.jwtPayload === 'object') {
        return req.jwtPayload;
    }
    const token = getBearerToken(req);
    if (!token)
        return undefined;
    const decoded = jsonwebtoken_1.default.decode(token);
    if (!decoded || typeof decoded !== 'object')
        return undefined;
    return decoded;
}
function readHeaderString(value) {
    if (Array.isArray(value))
        return value[0]?.trim() || undefined;
    if (typeof value === 'string')
        return value.trim() || undefined;
    return undefined;
}
function resolveTenantContext(req) {
    const payload = getJwtPayload(req);
    const tenantIdFromHeader = readHeaderString(req.header('X-Tenant-Id') ?? undefined);
    const tenantId = tenantIdFromHeader
        ?? payload?.tenantId
        ?? payload?.tenant_id
        ?? '';
    const orgId = payload?.orgId
        ?? payload?.org_id
        ?? payload?.organizationId
        ?? payload?.organization_id;
    const userId = payload?.userId
        ?? payload?.user_id
        ?? payload?.nodeId
        ?? payload?.sub
        ?? payload?.handle
        ?? '';
    const role = payload?.role ?? '';
    return { tenantId, orgId, userId, role };
}
/**
 * Express middleware factory for tenant context.
 */
function tenantContextMiddleware(options = {}) {
    const { requireTenant = false } = options;
    return (req, res, next) => {
        req.tenantContext = resolveTenantContext(req);
        if (requireTenant && !req.tenantContext.tenantId) {
            res.status(403).json({
                error: 'Tenant access denied',
                code: 'TENANT_REQUIRED',
                message: 'This request requires a tenantId.',
            });
            return;
        }
        next();
    };
}
exports.default = tenantContextMiddleware;
//# sourceMappingURL=tenant-context.js.map