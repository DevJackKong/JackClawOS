"use strict";
/**
 * Message Trace API — query message status and full delivery trace
 *
 * GET /api/chat/message/:id/status  → current status
 * GET /api/chat/message/:id/trace   → full state transition history
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const chat_worker_1 = require("../chat-worker");
const router = (0, express_1.Router)();
/**
 * GET /api/chat/message/:id/status
 * Returns the current delivery status of a message.
 */
router.get('/message/:id/status', (req, res) => {
    const { id } = req.params;
    const status = (0, chat_worker_1.getMessageStatus)(id);
    if (!status) {
        return res.status(404).json({ error: 'Message not found or not tracked', messageId: id });
    }
    return res.json({ messageId: id, status, ts: Date.now() });
});
/**
 * GET /api/chat/message/:id/trace
 * Returns the full state transition history of a message.
 */
router.get('/message/:id/trace', (req, res) => {
    const { id } = req.params;
    const trace = (0, chat_worker_1.getMessageTrace)(id);
    if (trace.length === 0) {
        return res.status(404).json({ error: 'No trace found', messageId: id });
    }
    const currentStatus = trace[trace.length - 1].to;
    return res.json({
        messageId: id,
        currentStatus,
        transitions: trace,
        count: trace.length,
    });
});
exports.default = router;
//# sourceMappingURL=trace.js.map