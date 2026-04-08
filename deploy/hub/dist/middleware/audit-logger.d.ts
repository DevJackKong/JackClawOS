import { RequestHandler } from 'express';
/**
 * 审计日志中间件。
 * Audit logging middleware.
 *
 * 在请求完成后自动记录写操作的审计信息。
 * Automatically logs audit entries for write operations after the response finishes.
 */
export declare function auditLoggerMiddleware(): RequestHandler;
//# sourceMappingURL=audit-logger.d.ts.map