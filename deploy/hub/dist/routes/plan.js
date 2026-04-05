"use strict";
/**
 * Hub Plan Route — CEO 侧任务规划
 * POST /api/plan/estimate
 * 把规划请求转发给指定 Node，返回 ExecutionPlan
 * 如果没有指定 Node，使用启发式规则本地估算
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const nodes_1 = require("../store/nodes");
const server_1 = require("../server");
const router = (0, express_1.Router)();
router.post('/estimate', (0, server_1.asyncHandler)(async (req, res) => {
    const { taskId, title, description, nodeId, useAi = true } = req.body ?? {};
    if (!title || !description) {
        res.status(400).json({ error: 'title and description required' });
        return;
    }
    // 如果指定了 nodeId，转发给该 Node 的 /api/plan
    if (nodeId) {
        const nodes = (0, nodes_1.getAllNodes)();
        const node = nodes.find(n => n.nodeId === nodeId);
        if (!node) {
            res.status(404).json({ error: `Node not found: ${nodeId}` });
            return;
        }
        try {
            const baseUrl = node.callbackUrl ?? 'http://localhost:19000';
            const nodeUrl = `${baseUrl}/api/plan`;
            const resp = await fetch(nodeUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId, title, description, useAi }),
                signal: AbortSignal.timeout(35000),
            });
            const data = await resp.json();
            res.json(data);
        }
        catch (err) {
            res.status(502).json({ error: `Failed to reach node: ${err.message}` });
        }
        return;
    }
    // 无 Node 指定：本地启发式估算（无 AI，快速响应）
    const wordCount = description.split(/\s+/).length;
    const complexity = wordCount > 200 ? 'complex'
        : wordCount > 80 ? 'moderate'
            : wordCount > 30 ? 'simple'
                : 'trivial';
    const minutesMap = { trivial: 5, simple: 20, moderate: 60, complex: 180, epic: 480 };
    const tokenMap = { trivial: 500, simple: 2000, moderate: 8000, complex: 25000, epic: 80000 };
    const mins = minutesMap[complexity];
    const tokens = tokenMap[complexity];
    res.json({
        plan: {
            taskId: taskId ?? `plan-${Date.now()}`,
            title,
            complexity,
            estimatedMinutesSerial: mins,
            estimatedMinutesParallel: Math.ceil(mins * 0.4),
            parallelSpeedup: 2.5,
            estimatedTotalTokens: tokens,
            estimatedCostUsd: Math.round(tokens / 1_000_000 * 3.0 * 100) / 100,
            needsParallel: complexity !== 'trivial',
            suggestedAgentCount: complexity === 'complex' ? 3 : complexity === 'moderate' ? 2 : 1,
            subtasks: [],
            parallelBatches: [],
            overallRisk: 'low',
            risks: [],
            plannerVersion: '1.0',
            plannedAt: Date.now(),
        },
        note: 'Heuristic estimate (no AI). Specify nodeId for AI-powered planning.',
    });
}));
exports.default = router;
//# sourceMappingURL=plan.js.map