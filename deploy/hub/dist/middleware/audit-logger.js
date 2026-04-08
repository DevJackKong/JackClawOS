"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditLoggerMiddleware = auditLoggerMiddleware;
const audit_store_1 = require("../store/audit-store");
/**
 * 审计日志中间件。
 * Audit logging middleware.
 *
 * 在请求完成后自动记录写操作的审计信息。
 * Automatically logs audit entries for write operations after the response finishes.
 */
function auditLoggerMiddleware() {
    return (req, res, next) => {
        const start = Date.now();
        res.on('finish', () => {
            // 只记录写操作。 Only record mutating requests.
            if (['GET', 'HEAD', 'OPTIONS'].includes(req.method))
                return;
            // 排除健康检查。 Exclude health checks.
            if (req.path === '/health' || req.path === '/api/health')
                return;
            const tenantId = req.tenantContext?.tenantId ?? '';
            const userId = req.tenantContext?.userId ?? req.jwtPayload?.nodeId ?? '';
            try {
                audit_store_1.auditStore.log({
                    tenantId,
                    userId,
                    method: req.method,
                    path: `${req.baseUrl}${req.path}`,
                    statusCode: res.statusCode,
                    result: res.statusCode < 400
                        ? 'success'
                        : res.statusCode === 403
                            ? 'rejected'
                            : 'failure',
                    ip: req.ip,
                    userAgent: req.headers['user-agent'],
                    durationMs: Date.now() - start,
                });
            }
            catch {
                // 审计日志失败不应影响主请求流程。
            }
        });
        next();
    };
}
//# sourceMappingURL=audit-logger.js.map