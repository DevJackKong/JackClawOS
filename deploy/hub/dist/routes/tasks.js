"use strict";
/**
 * Hub Task Routes — /api/tasks
 *
 * Proxy task requests to nodes and track task state in memory.
 *
 * POST   /api/tasks/submit        — 提交任务到指定 Node（或自动选择）
 * GET    /api/tasks/:id           — 查询任务状态
 * GET    /api/tasks/list          — 任务列表
 * POST   /api/tasks/:id/cancel    — 取消任务
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = require("crypto");
const nodes_1 = require("../store/nodes");
const server_1 = require("../server");
const router = (0, express_1.Router)();
const tasks = new Map();
function pickNode(nodeId) {
    if (nodeId) {
        const n = (0, nodes_1.getNode)(nodeId);
        return n?.callbackUrl ? { nodeId: n.nodeId, callbackUrl: n.callbackUrl } : null;
    }
    const worker = (0, nodes_1.getAllNodes)().find(n => n.callbackUrl);
    return worker ? { nodeId: worker.nodeId, callbackUrl: worker.callbackUrl } : null;
}
// POST /api/tasks/submit
router.post('/submit', (0, server_1.asyncHandler)(async (req, res) => {
    const { nodeId, type = 'chat', prompt, context, model, maxTokens, temperature } = req.body ?? {};
    if (!prompt) {
        res.status(400).json({ error: 'prompt is required' });
        return;
    }
    const target = pickNode(nodeId);
    if (!target) {
        res.status(503).json({
            error: 'No available node',
            available: (0, nodes_1.getAllNodes)().map(n => n.nodeId),
        });
        return;
    }
    const taskId = (0, crypto_1.randomUUID)();
    const task = {
        id: taskId,
        nodeId: target.nodeId,
        type,
        prompt,
        status: 'running',
        submittedAt: Date.now(),
    };
    tasks.set(taskId, task);
    try {
        const nodeUrl = `${target.callbackUrl}/api/tasks/execute`;
        const resp = await fetch(nodeUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: taskId, type, prompt, context, model, maxTokens, temperature }),
            signal: AbortSignal.timeout(120000),
        });
        if (!resp.ok) {
            const errBody = await resp.text();
            task.status = 'failed';
            task.error = `Node error ${resp.status}: ${errBody.slice(0, 200)}`;
            task.completedAt = Date.now();
            res.status(502).json({ error: task.error, taskId });
            return;
        }
        const data = await resp.json();
        task.status = data.status ?? 'completed';
        task.output = data.output;
        task.error = data.error;
        task.tokenUsage = data.tokenUsage;
        task.model = data.model;
        task.duration = data.duration;
        task.completedAt = Date.now();
        res.json({ taskId, ...data });
    }
    catch (err) {
        task.status = 'failed';
        task.error = err.message;
        task.completedAt = Date.now();
        res.status(502).json({ error: err.message, taskId });
    }
}));
// GET /api/tasks/list
router.get('/list', (0, server_1.asyncHandler)(async (req, res) => {
    const { nodeId, limit = '50' } = req.query;
    let list = [...tasks.values()].sort((a, b) => b.submittedAt - a.submittedAt);
    if (nodeId)
        list = list.filter(t => t.nodeId === nodeId);
    res.json({ tasks: list.slice(0, Number(limit)) });
}));
// GET /api/tasks/:id
router.get('/:id', (0, server_1.asyncHandler)(async (req, res) => {
    const task = tasks.get(req.params.id);
    if (!task) {
        res.status(404).json({ error: 'Task not found' });
        return;
    }
    res.json(task);
}));
// POST /api/tasks/:id/cancel
router.post('/:id/cancel', (0, server_1.asyncHandler)(async (req, res) => {
    const task = tasks.get(req.params.id);
    if (!task) {
        res.status(404).json({ error: 'Task not found' });
        return;
    }
    if (task.status !== 'running') {
        res.json({ taskId: task.id, status: task.status, message: 'Task is not running' });
        return;
    }
    // Forward cancel to node
    const node = (0, nodes_1.getNode)(task.nodeId);
    if (node?.callbackUrl) {
        fetch(`${node.callbackUrl}/api/tasks/${task.id}/cancel`, { method: 'POST' })
            .catch(() => { });
    }
    task.status = 'cancelled';
    task.completedAt = Date.now();
    res.json({ taskId: task.id, status: 'cancelled' });
}));
exports.default = router;
//# sourceMappingURL=tasks.js.map