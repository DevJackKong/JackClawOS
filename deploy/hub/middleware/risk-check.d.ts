import { RequestHandler } from 'express';
/**
 * 风控检查中间件。
 * Risk check middleware.
 *
 * - 只检查有副作用的请求（跳过 GET / HEAD / OPTIONS）
 * - Attaches risk result onto req for downstream handlers
 * - block: 直接返回 403
 * - require_approval / warn: 通过响应头透出风控信号，但继续放行
 */
export declare function riskCheckMiddleware(): RequestHandler;
//# sourceMappingURL=risk-check.d.ts.map