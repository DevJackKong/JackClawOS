"use strict";
/**
 * Audit Routes — /api/audit
 * 审计日志路由 —— /api/audit
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const audit_store_1 = require("../store/audit-store");
const server_1 = require("../server");
const router = (0, express_1.Router)();
/**
 * POST /api/audit
 * Manually write one audit log.
 * 手动写入一条审计日志。
 */
router.post('/', (0, server_1.asyncHandler)(async (req, res) => {
    const body = (req.body ?? {});
    const method = typeof body.method === 'string' ? body.method : 'MANUAL';
    const reqPath = typeof body.path === 'string' ? body.path : '/api/audit';
    const statusCode = typeof body.statusCode === 'number' ? body.statusCode : 200;
    const entry = {
        tenantId: typeof body.tenantId === 'string' ? body.tenantId : undefined,
        userId: typeof body.userId === 'string' ? body.userId : undefined,
        method,
        path: reqPath,
        statusCode,
        result: statusCode < 400 ? 'success' : (statusCode === 403 ? 'rejected' : 'failure'),
        ip: typeof body.ip === 'string' ? body.ip : req.ip,
        userAgent: typeof body.userAgent === 'string' ? body.userAgent : req.headers['user-agent'],
    };
    audit_store_1.auditStore.log(entry);
    res.status(201).json({ success: true, entry });
}));
/**
 * GET /api/audit
 * List recent audit logs (read from JSONL).
 * 列出最近的审计日志。
 */
router.get('/', (0, server_1.asyncHandler)(async (_req, res) => {
    // auditStore 是 append-only JSONL，目前不提供 query 方法
    // 返回提示信息
    res.json({ success: true, message: 'Audit logs are append-only JSONL. Use POST to write.' });
}));
exports.default = router;
//# sourceMappingURL=audit.js.map