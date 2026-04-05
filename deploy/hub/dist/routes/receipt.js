"use strict";
/**
 * Hub Receipt 路由
 *
 * POST /receipt/delivered   — 标记送达
 * POST /receipt/read        — 标记已读
 * POST /receipt/read-batch  — 批量标记已读
 * POST /receipt/typing      — 发送输入中状态
 * GET  /receipt/status/:messageId — 查询消息状态
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const chat_1 = require("./chat");
const chat_worker_1 = require("../chat-worker");
const router = (0, express_1.Router)();
const receiptStore = new Map();
function getOrCreate(messageId) {
    let state = receiptStore.get(messageId);
    if (!state) {
        const msg = chat_worker_1.chatWorker.store.getMessage(messageId);
        state = {
            from: msg?.from ?? '',
            status: 'accepted',
            deliveredTo: new Set(),
            readBy: new Set(),
        };
        receiptStore.set(messageId, state);
    }
    return state;
}
// POST /api/receipt/delivered
router.post('/delivered', (req, res) => {
    const { messageId, nodeId } = req.body;
    if (!messageId || !nodeId) {
        res.status(400).json({ error: 'messageId and nodeId required' });
        return;
    }
    const state = getOrCreate(messageId);
    state.deliveredTo.add(nodeId);
    if (state.status === 'accepted' || state.status === 'sent') {
        state.status = 'acked';
    }
    const receipt = { messageId, status: 'acked', nodeId, ts: Date.now() };
    if (state.from) {
        (0, chat_1.pushToNodeWs)(state.from, 'receipt', receipt);
    }
    res.json({ status: 'ok', receipt });
});
// POST /api/receipt/read
router.post('/read', (req, res) => {
    const { messageId, readBy } = req.body;
    if (!messageId || !readBy) {
        res.status(400).json({ error: 'messageId and readBy required' });
        return;
    }
    const state = getOrCreate(messageId);
    state.readBy.add(readBy);
    state.status = 'consumed';
    const receipt = { messageId, readBy, ts: Date.now() };
    if (state.from) {
        (0, chat_1.pushToNodeWs)(state.from, 'receipt', { ...receipt, status: 'consumed' });
    }
    res.json({ status: 'ok', receipt });
});
// POST /api/receipt/read-batch
router.post('/read-batch', (req, res) => {
    const { messageIds, readBy } = req.body;
    if (!Array.isArray(messageIds) || messageIds.length === 0 || !readBy) {
        res.status(400).json({ error: 'messageIds (array) and readBy required' });
        return;
    }
    const ts = Date.now();
    const receipts = [];
    for (const messageId of messageIds) {
        const state = getOrCreate(messageId);
        state.readBy.add(readBy);
        state.status = 'consumed';
        const receipt = { messageId, readBy, ts };
        receipts.push(receipt);
        if (state.from) {
            (0, chat_1.pushToNodeWs)(state.from, 'receipt', { ...receipt, status: 'consumed' });
        }
    }
    res.json({ status: 'ok', count: receipts.length, receipts });
});
// POST /api/receipt/typing
router.post('/typing', (req, res) => {
    const { fromAgent, threadId, isTyping, to } = req.body;
    if (!fromAgent || !threadId) {
        res.status(400).json({ error: 'fromAgent and threadId required' });
        return;
    }
    const indicator = { fromAgent, threadId, isTyping: Boolean(isTyping) };
    if (to) {
        (0, chat_1.pushToNodeWs)(to, 'typing', indicator);
    }
    res.json({ status: 'ok', indicator });
});
// GET /api/receipt/status/:messageId
router.get('/status/:messageId', (req, res) => {
    const { messageId } = req.params;
    const state = receiptStore.get(messageId);
    if (!state) {
        const msg = chat_worker_1.chatWorker.store.getMessage(messageId);
        if (!msg) {
            res.status(404).json({ error: 'Message not found' });
            return;
        }
        res.json({ messageId, status: 'accepted', deliveredTo: [], readBy: [] });
        return;
    }
    res.json({
        messageId,
        status: state.status,
        deliveredTo: [...state.deliveredTo],
        readBy: [...state.readBy],
    });
});
exports.default = router;
//# sourceMappingURL=receipt.js.map