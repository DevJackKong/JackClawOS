/**
 * Hub Health & Observability API
 *
 * GET /health              → basic health check
 * GET /health/detailed     → full system status
 * GET /health/metrics      → prometheus-style metrics
 */

import { Router, Request, Response } from 'express'
import os from 'os'
import { chatWorker } from '../chat-worker'
import { offlineQueue } from '../store/offline-queue'
import { messageStore } from '../store/message-store'

const router = Router()
const startTime = Date.now()

// ─── Basic health check ───────────────────────────────────────────────────────

router.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'jackclaw-hub',
    version: '0.2.0',
    uptime: Math.round((Date.now() - startTime) / 1000),
    ts: Date.now(),
  })
})

// ─── Detailed system status ───────────────────────────────────────────────────

router.get('/detailed', (_req: Request, res: Response) => {
  const chatStats = chatWorker.getStats()
  const storeStats = messageStore.getStats()
  const mem = process.memoryUsage()
  const cpus = os.cpus()

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
      totalPending: offlineQueue.totalPending(),
    },

    // System resources
    system: {
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      cpuCount: cpus.length,
      loadAvg: os.loadavg(),
      totalMem: Math.round(os.totalmem() / 1024 / 1024),
      freeMem: Math.round(os.freemem() / 1024 / 1024),
    },

    // Process memory
    memory: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      external: Math.round(mem.external / 1024 / 1024),
    },
  })
})

// ─── Metrics (simple key=value format) ────────────────────────────────────────

router.get('/metrics', (_req: Request, res: Response) => {
  const chatStats = chatWorker.getStats()
  const storeStats = messageStore.getStats()
  const mem = process.memoryUsage()

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
    `hub_offline_pending ${offlineQueue.totalPending()}`,
    `hub_memory_rss_mb ${Math.round(mem.rss / 1024 / 1024)}`,
    `hub_memory_heap_used_mb ${Math.round(mem.heapUsed / 1024 / 1024)}`,
    `hub_cpu_load_1m ${os.loadavg()[0].toFixed(2)}`,
  ]

  res.type('text/plain').send(lines.join('\n') + '\n')
})

export default router
