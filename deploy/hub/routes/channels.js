"use strict";
/**
 * routes/channels.ts — Hub channel management routes
 *
 * SECURITY: all routes require admin role.
 * callbackUrl is never exposed in responses.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const axios_1 = __importDefault(require("axios"));
const nodes_1 = require("../store/nodes");
const rbac_helpers_1 = require("./rbac-helpers");
const router = (0, express_1.Router)();
// ─── GET /api/channels ────────────────────────────────────────────────────────
// Admin only. Aggregate channel lists from all registered nodes.
// SECURITY: callbackUrl stripped from response.
router.get('/', (req, res) => {
    if (!(0, rbac_helpers_1.requireAdmin)(req, res))
        return;
    void (async () => {
        const nodes = (0, nodes_1.getAllNodes)();
        const results = await Promise.all(nodes.map(async (node) => {
            if (!node.callbackUrl) {
                return { nodeId: node.nodeId, name: node.name, channels: [], error: 'no callbackUrl' };
            }
            try {
                const r = await axios_1.default.get(`${node.callbackUrl}/api/channels`, { timeout: 3000 });
                return { nodeId: node.nodeId, name: node.name, channels: r.data?.channels ?? [] };
            }
            catch {
                return { nodeId: node.nodeId, name: node.name, channels: [], error: 'unreachable' };
            }
        }));
        res.json({ nodes: results });
    })();
});
// ─── POST /api/channels/configure ────────────────────────────────────────────
// Admin only. Forward channel configuration to a specific node.
router.post('/configure', (req, res) => {
    if (!(0, rbac_helpers_1.requireAdmin)(req, res))
        return;
    void (async () => {
        const { nodeId, channel, config } = req.body;
        if (!nodeId || !channel || !config) {
            res.status(400).json({ error: 'nodeId, channel, and config are required' });
            return;
        }
        const nodes = (0, nodes_1.getAllNodes)();
        const node = nodes.find(n => n.nodeId === nodeId);
        if (!node) {
            res.status(404).json({ error: `Node not found: ${nodeId}` });
            return;
        }
        if (!node.callbackUrl) {
            res.status(422).json({ error: `Node ${nodeId} has no callbackUrl` });
            return;
        }
        try {
            const r = await axios_1.default.post(`${node.callbackUrl}/api/channels/configure`, { channel, config }, { timeout: 5000 });
            res.json(r.data);
        }
        catch (err) {
            const status = err?.response?.status ?? 502;
            const message = err?.response?.data?.error ?? err?.message ?? 'Node unreachable';
            res.status(status).json({ error: message });
        }
    })();
});
// ─── GET /api/channels/stats ──────────────────────────────────────────────────
// Admin only. Aggregate per-channel stats from all nodes.
// SECURITY: callbackUrl stripped from response.
router.get('/stats', (req, res) => {
    if (!(0, rbac_helpers_1.requireAdmin)(req, res))
        return;
    void (async () => {
        const nodes = (0, nodes_1.getAllNodes)();
        const results = await Promise.all(nodes.map(async (node) => {
            if (!node.callbackUrl) {
                return { nodeId: node.nodeId, name: node.name, stats: null, error: 'no callbackUrl' };
            }
            try {
                const r = await axios_1.default.get(`${node.callbackUrl}/api/channels/stats`, { timeout: 3000 });
                return { nodeId: node.nodeId, name: node.name, stats: r.data?.stats ?? null };
            }
            catch {
                return { nodeId: node.nodeId, name: node.name, stats: null, error: 'unreachable' };
            }
        }));
        res.json({ nodes: results });
    })();
});
exports.default = router;
//# sourceMappingURL=channels.js.map