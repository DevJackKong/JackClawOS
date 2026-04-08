"use strict";
// GET /api/summary?date=YYYY-MM-DD - Aggregated daily summary
// Groups all node reports by role
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const reports_1 = require("../store/reports");
const nodes_1 = require("../store/nodes");
const router = (0, express_1.Router)();
router.get('/', (req, res) => {
    const { date } = req.query;
    // Validate date format if provided
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.', code: 'VALIDATION_ERROR' });
        return;
    }
    try {
        const targetDate = date ?? new Date().toISOString().slice(0, 10);
        const allNodes = (0, nodes_1.getAllNodes)();
        const nodeMap = Object.fromEntries(allNodes.map(n => [n.nodeId, n]));
        const dailyReports = (0, reports_1.getAllNodeReportsForDate)(targetDate);
        const byRole = {};
        const reportingNodeIds = new Set();
        for (const daily of dailyReports) {
            if (daily.reports.length === 0)
                continue;
            const node = nodeMap[daily.nodeId];
            if (!node)
                continue;
            const role = node.role;
            if (!byRole[role]) {
                byRole[role] = { role, nodes: [] };
            }
            // Use the latest report entry for the day
            const latestReport = daily.reports[daily.reports.length - 1];
            // Respect visibility: private reports are excluded from summary
            if (latestReport.visibility === 'private')
                continue;
            reportingNodeIds.add(daily.nodeId);
            byRole[role].nodes.push({
                nodeId: daily.nodeId,
                name: node.name,
                summary: latestReport.summary,
                period: latestReport.period,
                reportedAt: latestReport.timestamp,
            });
        }
        const response = {
            date: targetDate,
            byRole,
            totalNodes: allNodes.length,
            reportingNodes: reportingNodeIds.size,
        };
        res.json(response);
    }
    catch (err) {
        console.error('[summary] Error:', err);
        res.status(500).json({ error: err.message || 'Failed to generate summary', code: 'INTERNAL_ERROR' });
    }
});
exports.default = router;
//# sourceMappingURL=summary.js.map