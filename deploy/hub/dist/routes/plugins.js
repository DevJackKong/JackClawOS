"use strict";
/**
 * Plugin Management API
 *
 * GET  /api/plugins         → list loaded plugins
 * GET  /api/plugins/stats   → plugin system stats
 * POST /api/plugins/events  → list recent events
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const plugin_manager_1 = require("../plugin-manager");
const event_bus_1 = require("../event-bus");
const router = (0, express_1.Router)();
// GET /api/plugins
router.get('/', (_req, res) => {
    res.json({
        plugins: plugin_manager_1.pluginManager.list(),
        stats: plugin_manager_1.pluginManager.getStats(),
    });
});
// GET /api/plugins/stats
router.get('/stats', (_req, res) => {
    res.json(plugin_manager_1.pluginManager.getStats());
});
// GET /api/plugins/events
router.get('/events', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const events = event_bus_1.eventBus.getRecentEvents(limit);
    res.json({ events, count: events.length });
});
exports.default = router;
//# sourceMappingURL=plugins.js.map