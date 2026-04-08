import type { RequestHandler } from 'express';
/**
 * Middleware options.
 * 中间件配置项。
 */
export interface TenantContextMiddlewareOptions {
    requireTenant?: boolean;
}
/**
 * Express middleware factory for tenant context.
 */
export declare function tenantContextMiddleware(options?: TenantContextMiddlewareOptions): RequestHandler;
export default tenantContextMiddleware;
//# sourceMappingURL=tenant-context.d.ts.map