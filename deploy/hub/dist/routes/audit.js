"use strict";
/**
 * Audit Routes — /api/audit
 * 审计日志路由 —— /api/audit
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const audit_store_1 = require("../store/audit-store");
const server_1 = require("../server");
const rbac_helpers_1 = require("./rbac-helpers");
const router = (0, express_1.Router)();
/**
 * POST /api/audit
 * Manually write one audit log.
 * SECURITY: only admin can write audit logs; userId bound from JWT
 */
router.post('/', (0, server_1.asyncHandler)(async (req, res) => {
    const adminId = (0, rbac_helpers_1.requireAdmin)(req, res);
    if (!adminId)
        return;
    const body = (req.body ?? {});
    const method = typeof body.method === 'string' ? body.method : 'MANUAL';
    const reqPath = typeof body.path === 'string' ? body.path : '/api/audit';
    const statusCode = typeof body.statusCode === 'number' ? body.statusCode : 200;
    const entry = {
        tenantId: typeof body.tenantId === 'string' ? body.tenantId : undefined,
        userId: adminId, // SECURITY: always from JWT, never trust body
        method,
        path: reqPath,
        statusCode,
        result: statusCode < 400 ? 'success' : (statusCode === 403 ? 'rejected' : 'failure'),
        ip: req.ip,
        userAgent: req.headers['user-agent'],
    };
    audit_store_1.auditStore.log(entry);
    res.status(201).json({ success: true, entry });
}));
/**
 * GET /api/audit — SECURITY: admin only
 */
router.get('/', (0, server_1.asyncHandler)(async (req, res) => {
    if (!(0, rbac_helpers_1.requireAdmin)(req, res))
        return;
    res.json({ success: true, message: 'Audit logs are append-only JSONL. Use POST to write.' });
}));
exports.default = router;
//# sourceMappingURL=audit.js.map