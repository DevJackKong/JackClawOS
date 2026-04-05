"use strict";
// Hub routes - HumanInLoop 审查 API
// POST /api/review/request  — 提交人工审查请求
// GET  /api/review/pending  — 查询待处理请求
// POST /api/review/resolve/:requestId — 真人决策（需 human-token header）
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const protocol_1 = require("@jackclaw/protocol");
const server_1 = require("../server");
const router = (0, express_1.Router)();
/**
 * POST /api/review/request
 * Body: Omit<HumanReviewRequest, 'requestId' | 'createdAt'>
 * Returns: { requestId }
 */
router.post('/request', (0, server_1.asyncHandler)(async (req, res) => {
    const body = req.body;
    // 基本字段校验
    if (!body.trigger || !body.nodeId || !body.description) {
        res.status(400).json({
            error: 'Missing required fields: trigger, nodeId, description',
        });
        return;
    }
    if (!body.options || !Array.isArray(body.options) || body.options.length === 0) {
        res.status(400).json({
            error: 'options must be a non-empty array of ReviewOption',
        });
        return;
    }
    if (!body.defaultOnTimeout) {
        res.status(400).json({
            error: 'defaultOnTimeout is required (approve | reject | defer)',
        });
        return;
    }
    try {
        const requestId = await protocol_1.humanInLoopManager.requestReview({
            trigger: body.trigger,
            nodeId: body.nodeId,
            description: body.description,
            context: body.context ?? {},
            options: body.options,
            deadline: body.deadline,
            defaultOnTimeout: body.defaultOnTimeout,
        });
        res.status(201).json({ requestId });
    }
    catch (err) {
        res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
    }
}));
/**
 * GET /api/review/pending
 * Query: ?nodeId=xxx (optional)
 * Returns: { requests: HumanReviewRequest[] }
 */
router.get('/pending', (0, server_1.asyncHandler)(async (req, res) => {
    const nodeId = req.query.nodeId;
    try {
        const requests = await protocol_1.humanInLoopManager.getPending(nodeId);
        res.json({ requests });
    }
    catch (err) {
        res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
    }
}));
/**
 * POST /api/review/resolve/:requestId
 * Headers: human-token: <HMAC token>
 * Body: { decision: string }
 * Returns: { success: true }
 *
 * human-token = HMAC-SHA256(requestId, HUMAN_TOKEN_SECRET)
 * 只有持有 secret 的真人调用者可以执行此操作。
 */
router.post('/resolve/:requestId', (0, server_1.asyncHandler)(async (req, res) => {
    const { requestId } = req.params;
    const humanToken = req.headers['human-token'];
    const { decision } = req.body;
    if (!humanToken) {
        res.status(401).json({ error: 'Missing human-token header' });
        return;
    }
    if (!decision) {
        res.status(400).json({ error: 'Missing decision in request body' });
        return;
    }
    try {
        await protocol_1.humanInLoopManager.resolve(requestId, decision, humanToken);
        res.json({ success: true });
    }
    catch (err) {
        const message = err.message;
        if (message.includes('not found')) {
            res.status(404).json({ error: message });
        }
        else if (message.includes('Unauthorized') || message.includes('Invalid human-token')) {
            res.status(403).json({ error: message });
        }
        else if (message.includes('already resolved')) {
            res.status(409).json({ error: message });
        }
        else {
            res.status(400).json({ error: message, code: 'BAD_REQUEST' });
        }
    }
}));
exports.default = router;
//# sourceMappingURL=human-review.js.map