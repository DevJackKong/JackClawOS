"use strict";
/**
 * Hub Health & Observability API
 *
 * GET /health              → basic health check
 * GET /health/detailed     → full system status
 * GET /health/metrics      → prometheus-style metrics
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const os_1 = __importDefault(require("os"));
const chat_worker_1 = require("../chat-worker");
const offline_queue_1 = require("../store/offline-queue");
const message_store_1 = require("../store/message-store");
const router = (0, express_1.Router)();
const startTime = Date.now();
// ─── Basic health check ───────────────────────────────────────────────────────
router.get('/', (_req, res) => {
    res.json({
        status: 'ok',
        service: 'jackclaw-hub',
        version: '0.2.0',
        uptime: Math.round((Date.now() - startTime) / 1000),
        ts: Date.now(),
    });
});
// ─── Detailed system status ───────────────────────────────────────────────────
router.get('/detailed', (_req, res) => {
    const chatStats = chat_worker_1.chatWorker.getStats();
    const storeStats = message_store_1.messageStore.getStats();
    const mem = process.memoryUsage();
    const cpus = os_1.default.cpus();
    res.json({
        status: 'ok',
        uptime: Math.round((Date.now() - startTime) / 1000),
        ts: Date.now(),
        // Chat worker stats
        chat: {
            connections: chatStats.connections,
            queueDepth: chatStats.queueDepth,
            overflowActive: chatStats.overflowActive,
            totalReceived: chatStats.totalReceived,
            totalDelivered: chatStats.totalDelivered,
            totalQueued: chatStats.totalQueued,
            avgLatencyMs: chatStats.avgLatencyMs,
        },
        // Message store stats
        store: {
            totalMessages: storeStats.totalMessages,
            totalThreads: storeStats.totalThreads,
        },
        // Offline queue
        offlineQueue: {
            totalPending: offline_queue_1.offlineQueue.totalPending(),
        },
        // System resources
        system: {
            platform: os_1.default.platform(),
            arch: os_1.default.arch(),
            nodeVersion: process.version,
            cpuCount: cpus.length,
            loadAvg: os_1.default.loadavg(),
            totalMem: Math.round(os_1.default.totalmem() / 1024 / 1024),
            freeMem: Math.round(os_1.default.freemem() / 1024 / 1024),
        },
        // Process memory
        memory: {
            rss: Math.round(mem.rss / 1024 / 1024),
            heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
            heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
            external: Math.round(mem.external / 1024 / 1024),
        },
    });
});
// ─── Metrics (simple key=value format) ────────────────────────────────────────
router.get('/metrics', (_req, res) => {
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
exports.default = router;
//# sourceMappingURL=health.js.map