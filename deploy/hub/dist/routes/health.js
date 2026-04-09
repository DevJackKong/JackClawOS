"use strict";
/**
 * Hub Health & Observability API
 *
 * GET /health              → basic health check (public, minimal)
 * GET /health/detailed     → full system status (JWT required)
 * GET /health/metrics      → prometheus-style metrics (JWT required)
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.protectedHealthRouter = exports.publicHealthRouter = void 0;
const express_1 = require("express");
const os_1 = __importDefault(require("os"));
const server_1 = require("../server");
const chat_worker_1 = require("../chat-worker");
const offline_queue_1 = require("../store/offline-queue");
const message_store_1 = require("../store/message-store");
const startTime = Date.now();
// ─── JWT helper for protected health endpoints ───────────────────────────────
function requireAuth(req, res) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Unauthorized' });
        return false;
    }
    try {
        (0, server_1.verifyJWT)(authHeader.slice(7));
        return true;
    }
    catch {
        res.status(401).json({ error: 'Invalid or expired token' });
        return false;
    }
}
// ─── Public health check (minimal info) ───────────────────────────────────────
exports.publicHealthRouter = (0, express_1.Router)();
exports.publicHealthRouter.get('/', (_req, res) => {
    res.json({ status: 'ok' });
});
// ─── Protected health routes (JWT required) ──────────────────────────────────
exports.protectedHealthRouter = (0, express_1.Router)();
exports.protectedHealthRouter.get('/detailed', (req, res) => {
    if (!requireAuth(req, res))
        return;
    const chatStats = chat_worker_1.chatWorker.getStats();
    const storeStats = message_store_1.messageStore.getStats();
    const mem = process.memoryUsage();
    const cpus = os_1.default.cpus();
    res.json({
        status: 'ok',
        uptime: Math.round((Date.now() - startTime) / 1000),
        ts: Date.now(),
        chat: {
            connections: chatStats.connections,
            queueDepth: chatStats.queueDepth,
            overflowActive: chatStats.overflowActive,
            totalReceived: chatStats.totalReceived,
            totalDelivered: chatStats.totalDelivered,
            totalQueued: chatStats.totalQueued,
            avgLatencyMs: chatStats.avgLatencyMs,
        },
        store: {
            totalMessages: storeStats.totalMessages,
            totalThreads: storeStats.totalThreads,
        },
        offlineQueue: {
            totalPending: offline_queue_1.offlineQueue.totalPending(),
        },
        system: {
            platform: os_1.default.platform(),
            arch: os_1.default.arch(),
            nodeVersion: process.version,
            cpuCount: cpus.length,
            loadAvg: os_1.default.loadavg(),
            totalMem: Math.round(os_1.default.totalmem() / 1024 / 1024),
            freeMem: Math.round(os_1.default.freemem() / 1024 / 1024),
        },
        memory: {
            rss: Math.round(mem.rss / 1024 / 1024),
            heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
            heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
            external: Math.round(mem.external / 1024 / 1024),
        },
    });
});
exports.protectedHealthRouter.get('/metrics', (req, res) => {
    if (!requireAuth(req, res))
        return;
    const chatStats = chat_worker_1.chatWorker.getStats();
    const storeStats = message_store_1.messageStore.getStats();
    const mem = process.memoryUsage();
    const lines = [
        `# Hub Metrics`,
        `hub_uptime_seconds ${Math.round((Date.now() - startTime) / 1000)}`,
        `hub_ws_connections ${chatStats.connections}`,
        `hub_queue_depth ${chatStats.queueDepth}`,
        `hub_messages_received_total ${chatStats.totalReceived}`,
        `hub_messages_delivered_total ${chatStats.totalDelivered}`,
        `hub_messages_queued_total ${chatStats.totalQueued}`,
        `hub_avg_latency_ms ${chatStats.avgLatencyMs}`,
        `hub_store_messages_total ${storeStats.totalMessages}`,
        `hub_store_threads_total ${storeStats.totalThreads}`,
        `hub_offline_pending ${offline_queue_1.offlineQueue.totalPending()}`,
        `hub_memory_rss_mb ${Math.round(mem.rss / 1024 / 1024)}`,
        `hub_memory_heap_used_mb ${Math.round(mem.heapUsed / 1024 / 1024)}`,
        `hub_cpu_load_1m ${os_1.default.loadavg()[0].toFixed(2)}`,
    ];
    res.type('text/plain').send(lines.join('\n') + '\n');
});
// Default export for backward compat (public only)
exports.default = exports.publicHealthRouter;
//# sourceMappingURL=health.js.map