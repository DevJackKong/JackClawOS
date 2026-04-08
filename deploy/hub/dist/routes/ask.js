"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Hub /api/ask — proxy LLM requests to nodes
 *
 * GET  /api/ask/providers  — list all nodes and their available LLM providers
 * POST /api/ask            — proxy prompt to a node (round-robin if nodeId omitted)
 */
const express_1 = require("express");
const http_1 = __importDefault(require("http"));
const nodes_js_1 = require("../store/nodes.js");
const server_js_1 = require("../server.js");
const rbac_helpers_1 = require("./rbac-helpers");
const router = (0, express_1.Router)();
// GET /providers — SECURITY: admin only (exposes node topology + callbackUrls internally)
router.get('/providers', (0, server_js_1.asyncHandler)(async (req, res) => {
    if (!(0, rbac_helpers_1.requireAdmin)(req, res))
        return;
    const nodes = (0, nodes_js_1.getAllNodes)().filter(n => n.callbackUrl);
    const results = await Promise.all(nodes.map(async (node) => {
        try {
            const url = new URL('/api/ask/providers', node.callbackUrl);
            const providers = await new Promise((resolve) => {
                const r = http_1.default.request(url, { method: 'GET', timeout: 5000 }, (resp) => {
                    let d = '';
                    resp.on('data', c => (d += c));
                    resp.on('end', () => {
                        try {
                            resolve(JSON.parse(d).providers ?? []);
                        }
                        catch {
                            resolve([]);
                        }
                    });
                });
                r.on('error', () => resolve([]));
                r.on('timeout', () => { r.destroy(); resolve([]); });
                r.end();
            });
            return { nodeId: node.nodeId, providers };
        }
        catch {
            return { nodeId: node.nodeId, providers: [] };
        }
    }));
    const nodeMap = {};
    for (const { nodeId, providers } of results)
        nodeMap[nodeId] = providers;
    res.json({ nodes: nodeMap });
}));
// POST / — route prompt to a specific node or auto-select an available worker
router.post('/', (0, server_js_1.asyncHandler)(async (req, res) => {
    const { nodeId, prompt, model, systemPrompt, temperature, max_tokens } = req.body;
    if (!prompt) {
        res.status(400).json({ error: 'prompt required' });
        return;
    }
    // Find target node
    const targetNode = nodeId
        ? (0, nodes_js_1.getNode)(nodeId)
        : (0, nodes_js_1.getAllNodes)().find(n => n.role !== 'ceo' && n.callbackUrl);
    if (!targetNode || !targetNode.callbackUrl) {
        const available = (0, nodes_js_1.getAllNodes)().map(n => n.nodeId);
        res.status(503).json({ error: 'No available node to handle request', available });
        return;
    }
    const nodeUrl = new URL('/api/ask', targetNode.callbackUrl);
    const body = JSON.stringify({ prompt, model, systemPrompt, temperature, max_tokens });
    try {
        const result = await new Promise((resolve, reject) => {
            const r = http_1.default.request(nodeUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
                timeout: 120000,
            }, (resp) => {
                let d = '';
                resp.on('data', c => (d += c));
                resp.on('end', () => {
                    try {
                        resolve(JSON.parse(d));
                    }
                    catch {
                        resolve({ error: 'invalid response', raw: d.slice(0, 200) });
                    }
                });
            });
            r.on('error', reject);
            r.on('timeout', () => { r.destroy(); reject(new Error('Node request timeout')); });
            r.write(body);
            r.end();
        });
        res.json({ ...result, routedTo: targetNode.nodeId });
    }
    catch (err) {
        res.status(502).json({ error: `Node unreachable: ${err.message}`, code: 'BAD_GATEWAY', nodeId: targetNode.nodeId });
    }
}));
exports.default = router;
//# sourceMappingURL=ask.js.map