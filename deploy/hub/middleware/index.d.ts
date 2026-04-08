/**
 * Tenant context middleware:
 * resolves tenant / org / user context from the incoming request.
 */
export { tenantContextMiddleware } from './tenant-context';
/**
 * RBAC guard middleware:
 * checks whether the current user can perform an action on a resource.
 */
export { rbacGuard } from './rbac-guard';
/**
 * Risk check middleware:
 * evaluates write operations and decides block / approval / warning.
 */
/**
 * Audit logger middleware:
 * records important write operations into the audit log.
 */
export { auditLoggerMiddleware } from './audit-logger';
export { riskCheckMiddleware } from './risk-check';
//# sourceMappingURL=index.d.ts.map