"use strict";
// GET  /api/nodes                     - List all registered nodes (CEO only)
// POST /api/nodes/:nodeId/workload     - Node pushes workload snapshot (self or CEO)
// JWT must have role === 'ceo' for GET
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const nodes_1 = require("../store/nodes");
const reports_1 = require("../store/reports");
const watchdog_1 = require("@jackclaw/watchdog");
const workload_cache_1 = require("../store/workload-cache");
const watchdog_2 = require("./watchdog");
const router = (0, express_1.Router)();
router.get('/', (req, res) => {
    // CEO-only check (role set on JWT by auth middleware)
    const { role } = req.jwtPayload ?? {};
    if (role !== 'ceo') {
        res.status(403).json({ error: 'Access denied. CEO role required.', code: 'FORBIDDEN' });
        return;
    }
    try {
        const nodes = (0, nodes_1.getAllNodes)();
        const result = nodes.map(node => {
            const lastReport = (0, reports_1.getLastReportEntry)(node.nodeId);
            const unackedAlerts = (0, watchdog_1.getAlerts)(node.nodeId, { acknowledged: false });
            const snapshot = (0, watchdog_1.getLatestSnapshot)(node.nodeId);
            const hb = watchdog_2.heartbeatStore.get(node.nodeId);
            const healthMetrics = hb ? (0, watchdog_2.resolveStatus)(hb) : null;
            return {
                nodeId: node.nodeId,
                name: node.name,
                role: node.role,
                registeredAt: node.registeredAt,
                lastReportAt: node.lastReportAt ?? null,
                lastReportSummary: lastReport?.summary ?? null,
                watchdogStatus: {
                    unackedAlerts: unackedAlerts.length,
                    criticalAlerts: unackedAlerts.filter(a => a.severity === 'critical').length,
                    lastSnapshotAt: snapshot?.timestamp ?? null,
                    memoryHash: snapshot?.memoryHash ?? null,
                },
                health: healthMetrics ? {
                    status: healthMetrics.status,
                    lastHeartbeat: healthMetrics.lastHeartbeat,
                    memUsage: healthMetrics.metrics.memUsage,
                    cpuLoad: healthMetrics.metrics.cpuLoad,
                    uptime: healthMetrics.metrics.uptime,
                    tasksCompleted: healthMetrics.metrics.tasksCompleted,
                    lastTaskAt: healthMetrics.metrics.lastTaskAt,
                } : null,
                workload: (0, workload_cache_1.getWorkload)(node.nodeId),
            };
        });
        res.json({
            success: true,
            total: result.length,
            nodes: result,
        });
    }
    catch (err) {
        console.error('[nodes] Error:', err);
        res.status(500).json({ error: err.message || 'Failed to list nodes', code: 'INTERNAL_ERROR' });
    }
});
/**
 * POST /api/nodes/:nodeId/workload
 * Nodes push their latest workload snapshot.
 * A node may only push for itself (unless CEO).
 */
router.post('/:nodeId/workload', (req, res) => {
    const jwtPayload = req.jwtPayload ?? { nodeId: '', role: '' };
    const { nodeId } = req.params;
    if (jwtPayload.role !== 'ceo' && jwtPayload.nodeId !== nodeId) {
        res.status(403).json({ error: 'Access denied. Can only push your own workload.', code: 'FORBIDDEN' });
        return;
    }
    const body = req.body;
    if (typeof body.activeTasks !== 'number' ||
        typeof body.queuedTasks !== 'number' ||
        typeof body.completedToday !== 'number') {
        res.status(400).json({ error: 'Missing required fields: activeTasks, queuedTasks, completedToday', code: 'VALIDATION_ERROR' });
        return;
    }
    try {
        (0, workload_cache_1.setWorkload)(nodeId, { ...body, nodeId, updatedAt: body.updatedAt ?? Date.now() });
        res.json({ success: true });
    }
    catch (err) {
        console.error('[nodes] workload error:', err);
        res.status(500).json({ error: err.message || 'Failed to update workload', code: 'INTERNAL_ERROR' });
    }
});
exports.default = router;
//# sourceMappingURL=nodes.js.map