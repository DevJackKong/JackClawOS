import { RequestHandler } from 'express'
import { riskEngine } from '../services/risk-engine'

/**
 * 风控检查中间件。
 * Risk check middleware.
 *
 * - 只检查有副作用的请求（跳过 GET / HEAD / OPTIONS）
 * - Attaches risk result onto req for downstream handlers
 * - block: 直接返回 403
 * - require_approval / warn: 通过响应头透出风控信号，但继续放行
 */
export function riskCheckMiddleware(): RequestHandler {
  return (req, res, next) => {
    // 跳过只读请求。
    // Skip read-only requests.
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()

    const result = riskEngine.evaluate({
      tenantId: (req as any).tenantContext?.tenantId ?? '',
      actorId: (req as any).tenantContext?.userId ?? (req as any).jwtPayload?.nodeId ?? '',
      actorType: 'user',
      action: `${req.method} ${req.baseUrl}${req.path}`,
      metadata: req.body,
      ip: req.ip,
      timestamp: Date.now(),
    })

    // 将风控结果挂到 req 上，供后续中间件 / 控制器复用。
    // Attach risk result to req for downstream middleware/controllers.
    ;(req as any).riskResult = result

    // 未通过风控时直接拦截。
    // Block the request immediately when risk check fails.
    if (!result.passed) {
      res.status(403).json({
        error: 'Risk check failed / 风控拦截',
        riskLevel: result.level,
        triggeredRules: result.triggeredRules,
      })
      return
    }

    // require_approval：打标记，不阻断。
    // require_approval: add header but do not block.
    if (result.triggeredRules.some((r: any) => r.action === 'require_approval')) {
      res.setHeader('X-Risk-Approval-Required', 'true')
    }

    // warn：添加告警 header。
    // warn: add warning header.
    if (result.triggeredRules.some((r: any) => r.action === 'warn')) {
      res.setHeader('X-Risk-Warning', 'true')
    }

    next()
  }
}
