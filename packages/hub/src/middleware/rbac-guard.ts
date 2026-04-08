import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { rbacStore } from '../store/rbac-store'

/**
 * RBAC guard middleware factory.
 * RBAC 权限守卫中间件工厂。
 *
 * Usage / 用法:
 * - router.get('/users', rbacGuard('users', 'read'), handler)
 * - router.post('/roles', rbacGuard('rbac', 'write'), handler)
 */
export function rbacGuard(resource: string, action: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Read user + tenant info from tenantContext.
    // 从 tenantContext 中读取用户和租户信息。
    const { userId, tenantId } = req.tenantContext ?? {}

    // Missing context is treated as no permission.
    // 缺少上下文时按无权限处理。
    if (!userId || !tenantId) {
      res.status(403).json({
        error: 'Permission denied',
        resource,
        action,
      })
      return
    }

    // Ask RBAC store whether the user can perform this action on the resource.
    // 调用 RBAC 存储检查用户是否有该资源动作权限。
    const allowed = rbacStore.checkPermission(userId, tenantId, resource, action)

    if (!allowed) {
      res.status(403).json({
        error: 'Permission denied',
        resource,
        action,
      })
      return
    }

    next()
  }
}

export default rbacGuard
