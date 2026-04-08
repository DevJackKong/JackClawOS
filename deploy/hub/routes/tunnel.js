"use strict";
/**
 * Hub reverse-tunnel route
 *
 * WS  /tunnel/ws?nodeId=xxx  — Intranet node establishes a persistent tunnel
 * ANY /tunnel/:nodeId/*       — External requests forwarded to the node via WS
 *
 * Protocol (JSON over WebSocket):
 *   Hub → Node: { type: 'request',  id, method, path, headers, body (base64) }
 *   Node → Hub: { type: 'response', id, status, headers, body (base64) }
 *   Hub → Node: { type: 'ready',    publicUrl }
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachTunnelWss = attachTunnelWss;
exports.getConnectedTunnels = getConnectedTunnels;
const express_1 = require("express");
const ws_1 = require("ws");
const crypto_1 = __importDefault(require("crypto"));
const router = (0, express_1.Router)();
// ─── State ────────────────────────────────────────────────────────────────────
/** nodeId → active WebSocket */
const tunnels = new Map();
/** requestId → pending promise callbacks */
const pending = new Map();
const REQUEST_TIMEOUT_MS = 30_000;
// ─── WebSocket Server ─────────────────────────────────────────────────────────
/**
 * Attach the tunnel WebSocket handler to an existing http.Server.
 * Call this alongside attachChatWss in hub/index.ts.
 */
function attachTunnelWss(server, hubUrl) {
    const wss = new ws_1.WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
        if (!req.url?.startsWith('/tunnel/ws'))
            return;
        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
        });
    });
    wss.on('connection', (ws, req) => {
        const params = new URL(req.url ?? '', 'http://hub').searchParams;
        const nodeId = params.get('nodeId');
        if (!nodeId) {
            ws.close(1008, 'nodeId required');
            return;
        }
        // Kick out any stale connection for this nodeId
        const existing = tunnels.get(nodeId);
        if (existing && existing.readyState === ws_1.WebSocket.OPEN) {
            existing.close(1001, 'replaced by new connection');
        }
        tunnels.set(nodeId, ws);
        console.log(`[tunnel] Node "${nodeId}" connected (${tunnels.size} active)`);
        // Acknowledge with the public URL the node will be reachable at
        const publicUrl = `${hubUrl.replace(/\/$/, '')}/tunnel/${nodeId}`;
        const ready = { type: 'ready', publicUrl };
        ws.send(JSON.stringify(ready));
        ws.on('message', (data) => {
            let msg;
            try {
                msg = JSON.parse(data.toString());
            }
            catch {
                return;
            }
            if (msg.type === 'response') {
                const entry = pending.get(msg.id);
                if (entry) {
                    clearTimeout(entry.timer);
                    pending.delete(msg.id);
                    entry.resolve(msg);
                }
            }
        });
        ws.on('close', () => {
            // Only remove if this is still the registered socket
            if (tunnels.get(nodeId) === ws) {
                tunnels.delete(nodeId);
                console.log(`[tunnel] Node "${nodeId}" disconnected (${tunnels.size} active)`);
            }
        });
        ws.on('error', (err) => {
            console.error(`[tunnel] Node "${nodeId}" error:`, err.message);
        });
    });
}
/** Returns a snapshot of all connected node IDs. */
function getConnectedTunnels() {
    return [...tunnels.keys()];
}
// ─── HTTP Forwarder ───────────────────────────────────────────────────────────
function forwardToNode(nodeId, method, path, headers, body) {
    const ws = tunnels.get(nodeId);
    if (!ws || ws.readyState !== ws_1.WebSocket.OPEN) {
        return Promise.reject(new Error(`Node "${nodeId}" is not connected`));
    }
    return new Promise((resolve, reject) => {
        const id = crypto_1.default.randomUUID();
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`Tunnel request to "${nodeId}" timed out`));
        }, REQUEST_TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer });
        const msg = {
            type: 'request',
            id,
            method,
            path,
            headers,
            body: body.toString('base64'),
        };
        ws.send(JSON.stringify(msg));
    });
}
// ─── Express Routes ───────────────────────────────────────────────────────────
// List active tunnels (no auth for monitoring/debug)
router.get('/', (_req, res) => {
    res.json({ tunnels: getConnectedTunnels() });
});
// Forward any request to the node — mounted at /tunnel, so path is /:nodeId[/rest]
router.all('/:nodeId', proxyHandler);
router.all('/:nodeId/*', proxyHandler);
async function proxyHandler(req, res) {
    const { nodeId } = req.params;
    // Reconstruct full path including query string
    const rawPath = req.url; // relative to mount point; starts with /:nodeId
    const nodePrefix = `/${nodeId}`;
    const suffix = rawPath.startsWith(nodePrefix) ? rawPath.slice(nodePrefix.length) || '/' : '/';
    // Collect request body
    const chunks = [];
    await new Promise((resolve, reject) => {
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', resolve);
        req.on('error', reject);
    });
    const body = Buffer.concat(chunks);
    // Strip hop-by-hop headers
    const HOP_BY_HOP = new Set([
        'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
        'te', 'trailers', 'transfer-encoding', 'upgrade',
    ]);
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
        if (!HOP_BY_HOP.has(k.toLowerCase()) && typeof v === 'string') {
            headers[k] = v;
        }
    }
    try {
        const response = await forwardToNode(nodeId, req.method ?? 'GET', suffix, headers, body);
        for (const [key, values] of Object.entries(response.headers)) {
            res.setHeader(key, values);
        }
        res.status(response.status).send(Buffer.from(response.body, 'base64'));
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Tunnel error';
        const status = message.includes('not connected') ? 503 : 502;
        res.status(status).json({ error: message });
    }
}
exports.default = router;
//# sourceMappingURL=tunnel.js.map