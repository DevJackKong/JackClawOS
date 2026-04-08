"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const plugin_system_1 = require("../plugin-system");
const server_1 = require("../server");
const router = (0, express_1.Router)();
/**
 * GET /api/plugins
 * 列出所有已注册插件 / List all registered plugins
 */
router.get('/', (0, server_1.asyncHandler)(async (_req, res) => {
    const plugins = plugin_system_1.pluginSystem.listPlugins();
    res.json({
        success: true,
        data: plugins,
    });
}));
/**
 * GET /api/plugins/:id
 * 获取单个插件详情 / Get a single plugin detail
 */
router.get('/:id', (0, server_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const plugin = plugin_system_1.pluginSystem.getPlugin(id);
    if (!plugin) {
        res.status(404).json({
            success: false,
            error: 'Plugin not found',
            code: 'PLUGIN_NOT_FOUND',
        });
        return;
    }
    res.json({
        success: true,
        data: plugin,
    });
}));
/**
 * POST /api/plugins/:id/enable
 * 启用插件 / Enable plugin
 */
router.post('/:id/enable', (0, server_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const plugin = plugin_system_1.pluginSystem.enable(id);
    res.json({
        success: true,
        message: 'Plugin enabled successfully',
        data: plugin,
    });
}));
/**
 * POST /api/plugins/:id/disable
 * 禁用插件 / Disable plugin
 */
router.post('/:id/disable', (0, server_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const plugin = plugin_system_1.pluginSystem.disable(id);
    res.json({
        success: true,
        message: 'Plugin disabled successfully',
        data: plugin,
    });
}));
/**
 * DELETE /api/plugins/:id
 * 卸载插件 / Unregister plugin
 */
router.delete('/:id', (0, server_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const removed = plugin_system_1.pluginSystem.unregister(id);
    if (!removed) {
        res.status(404).json({
            success: false,
            error: 'Plugin not found',
            code: 'PLUGIN_NOT_FOUND',
        });
        return;
    }
    res.json({
        success: true,
        message: 'Plugin unregistered successfully',
        data: { id, removed },
    });
}));
exports.default = router;
//# sourceMappingURL=plugins.js.map