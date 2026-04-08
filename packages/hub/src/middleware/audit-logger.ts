import { RequestHandler } from 'express'
import { auditStore } from '../store/audit-store'

/**
 * 审计日志中间件。
 * Audit logging middleware.
 *
 * 在请求完成后自动记录写操作的审计信息。
 * Automatically logs audit entries for write operations after the response finishes.
 */
export function auditLoggerMiddleware(): RequestHandler {
  return (req, res, next) => {
    const start = Date.now()

    res.on('finish', () => {
      // 只记录写操作。 Only record mutating requests.
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return
      // 排除健康检查。 Exclude health checks.
      if (req.path === '/health' || req.path === '/api/health') return

      const tenantId = (req as any).tenantContext?.tenantId ?? ''
      const userId = (req as any).tenantContext?.userId ?? (req as any).jwtPayload?.nodeId ?? ''

      try {
        auditStore.log({
          tenantId,
          userId,
          method: req.method,
          path: `${req.baseUrl}${req.path}`,
          statusCode: res.statusCode,
          result:
            res.statusCode < 400
              ? 'success'
              : res.statusCode === 403
                ? 'rejected'
                : 'failure',
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          durationMs: Date.now() - start,
        })
      } catch {
        // 审计日志失败不应影响主请求流程。
      }
    })

    next()
  }
}
