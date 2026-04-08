import type { RequestHandler } from 'express';
/**
 * RBAC guard middleware factory.
 * RBAC 权限守卫中间件工厂。
 *
 * Usage / 用法:
 * - router.get('/users', rbacGuard('users', 'read'), handler)
 * - router.post('/roles', rbacGuard('rbac', 'write'), handler)
 */
export declare function rbacGuard(resource: string, action: string): RequestHandler;
export default rbacGuard;
//# sourceMappingURL=rbac-guard.d.ts.map