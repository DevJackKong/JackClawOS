"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const chat_context_1 = require("../services/chat-context");
const server_1 = require("../server");
const router = (0, express_1.Router)();
/**
 * GET /api/chat-context/:nodeId
 * Get chat context for the specified node.
 * 获取指定 node 的聊天上下文。
 *
 * Query params:
 * - tenantId?: optional tenant scope / 可选租户作用域
 */
router.get('/:nodeId', (0, server_1.asyncHandler)(async (req, res) => {
    const nodeId = req.params.nodeId;
    const tenantId = req.query.tenantId;
    if (!nodeId?.trim()) {
        res.status(400).json({ error: 'nodeId is required', code: 'VALIDATION_ERROR' });
        return;
    }
    const chatContext = await chat_context_1.chatContextService.getContext(nodeId, tenantId);
    res.json(chatContext);
}));
exports.default = router;
//# sourceMappingURL=chat-context.js.map