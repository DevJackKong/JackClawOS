"use strict";
/**
 * OwnerMemory 授权区路由
 *
 * 主人视角（无需 token）：
 *   GET  /api/owner/snapshot      — 情绪快照
 *   GET  /api/owner/stats         — 关系统计
 *   GET  /api/owner/auth/pending  — 待审批申请
 *   POST /api/owner/auth/approve  — 批准申请
 *   POST /api/owner/auth/revoke   — 撤销授权
 *   GET  /api/owner/auth/grants   — 所有有效授权
 *   GET  /api/owner/auth/audit    — 访问日志
 *
 * 第三方产品侧：
 *   POST /api/owner/auth/request  — 申请授权
 *   POST /api/owner/auth/token    — 换取 access token
 *   GET  /api/owner/data/:scope   — 用 token 读取授权数据
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOwnerAuthRouter = createOwnerAuthRouter;
const express_1 = require("express");
const owner_memory_auth_1 = require("../owner-memory-auth");
const owner_memory_1 = require("../owner-memory");
function createOwnerAuthRouter(identity) {
    const router = (0, express_1.Router)();
    const auth = (0, owner_memory_auth_1.getOwnerMemoryAuth)(identity.nodeId);
    const memory = (0, owner_memory_1.getOwnerMemory)(identity.nodeId);
    // ── 主人视角：memory 只读 ──────────────────────────────────────────────────
    // GET /api/owner/snapshot — 情绪快照（主人自查，无需授权）
    router.get('/snapshot', (_req, res) => {
        res.json(memory.getEmotionSnapshot());
    });
    // GET /api/owner/stats — 关系统计（主人自查，无需授权）
    router.get('/stats', (_req, res) => {
        res.json(memory.getStats());
    });
    // ── 主人视角：授权管理 ────────────────────────────────────────────────────
    // GET /api/owner/auth/pending — 查看待审批的授权申请
    router.get('/auth/pending', (_req, res) => {
        res.json(auth.getPendingRequests());
    });
    // POST /api/owner/auth/approve — 批准授权申请
    // body: { requestId, scopes?: AccessScope[], expiryDays?: number, userNote?: string }
    router.post('/auth/approve', (req, res) => {
        const { requestId, scopes, expiryDays, userNote } = req.body ?? {};
        if (!requestId) {
            res.status(400).json({ error: 'requestId is required' });
            return;
        }
        try {
            const grant = auth.approve(requestId, { scopes, expiryDays, userNote });
            res.json({ grant });
        }
        catch (err) {
            res.status(400).json({ error: err.message });
        }
    });
    // POST /api/owner/auth/revoke — 撤销授权
    // body: { grantId }
    router.post('/auth/revoke', (req, res) => {
        const { grantId } = req.body ?? {};
        if (!grantId) {
            res.status(400).json({ error: 'grantId is required' });
            return;
        }
        try {
            auth.revoke(grantId);
            res.json({ ok: true, grantId });
        }
        catch (err) {
            res.status(400).json({ error: err.message });
        }
    });
    // GET /api/owner/auth/grants — 列出所有有效授权
    router.get('/auth/grants', (_req, res) => {
        res.json(auth.listGrants());
    });
    // GET /api/owner/auth/audit — 查看访问日志（可选 ?grantId=xxx 过滤）
    router.get('/auth/audit', (req, res) => {
        const grantId = req.query.grantId;
        res.json(auth.getAuditLog(grantId));
    });
    // ── 第三方产品侧 ──────────────────────────────────────────────────────────
    // POST /api/owner/auth/request — 申请授权
    // body: { clientId, clientName, productType, requestedScopes, reason, webhookUrl? }
    router.post('/auth/request', (req, res) => {
        const { clientId, clientName, productType, requestedScopes, reason, webhookUrl } = req.body ?? {};
        if (!clientId || !clientName || !productType || !requestedScopes || !reason) {
            res.status(400).json({ error: 'clientId, clientName, productType, requestedScopes, reason are required' });
            return;
        }
        try {
            const request = { clientId, clientName, productType, requestedScopes, reason, webhookUrl };
            const requestId = auth.requestAccess(request);
            res.json({ requestId, status: 'pending' });
        }
        catch (err) {
            res.status(400).json({ error: err.message });
        }
    });
    // POST /api/owner/auth/token — 用 grantId + clientSecret 换取 access token
    // body: { grantId, clientSecret }
    router.post('/auth/token', (req, res) => {
        const { grantId, clientSecret } = req.body ?? {};
        if (!grantId || !clientSecret) {
            res.status(400).json({ error: 'grantId and clientSecret are required' });
            return;
        }
        try {
            const token = auth.issueToken(grantId, clientSecret);
            res.json(token);
        }
        catch (err) {
            res.status(401).json({ error: err.message });
        }
    });
    // GET /api/owner/data/:scope — 读取授权数据（需要 Bearer token）
    // Header: Authorization: Bearer <token>
    router.get('/data/:scope', (req, res) => {
        const authHeader = req.headers.authorization ?? '';
        if (!authHeader.startsWith('Bearer ')) {
            res.status(401).json({ error: 'Authorization: Bearer <token> required' });
            return;
        }
        const token = authHeader.slice(7);
        const scope = req.params.scope;
        try {
            const entries = memory.get();
            const data = auth.access(token, scope, entries);
            res.json({ scope, data });
        }
        catch (err) {
            const status = err.message.includes('Token') || err.message.includes('Grant') ? 401 : 403;
            res.status(status).json({ error: err.message });
        }
    });
    return router;
}
//# sourceMappingURL=owner-auth.js.map