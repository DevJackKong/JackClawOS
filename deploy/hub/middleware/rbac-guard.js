"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rbacGuard = rbacGuard;
const rbac_store_1 = require("../store/rbac-store");
/**
 * RBAC guard middleware factory.
 * RBAC 权限守卫中间件工厂。
 *
 * Usage / 用法:
 * - router.get('/users', rbacGuard('users', 'read'), handler)
 * - router.post('/roles', rbacGuard('rbac', 'write'), handler)
 */
function rbacGuard(resource, action) {
    return (req, res, next) => {
        // Read user + tenant info from tenantContext.
        // 从 tenantContext 中读取用户和租户信息。
        const { userId, tenantId } = req.tenantContext ?? {};
        // Missing context is treated as no permission.
        // 缺少上下文时按无权限处理。
        if (!userId || !tenantId) {
            res.status(403).json({
                error: 'Permission denied',
                resource,
                action,
            });
            return;
        }
        // Ask RBAC store whether the user can perform this action on the resource.
        // 调用 RBAC 存储检查用户是否有该资源动作权限。
        const allowed = rbac_store_1.rbacStore.checkPermission(userId, tenantId, resource, action);
        if (!allowed) {
            res.status(403).json({
                error: 'Permission denied',
                resource,
                action,
            });
            return;
        }
        next();
    };
}
exports.default = rbacGuard;
//# sourceMappingURL=rbac-guard.js.map