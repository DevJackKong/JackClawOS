/**
 * Hub Health & Observability API
 *
 * GET /health              → basic health check (public, minimal)
 * GET /health/detailed     → full system status (JWT required)
 * GET /health/metrics      → prometheus-style metrics (JWT required)
 */

import { Router, Request, Response } from 'express'
import os from 'os'
import jwt from 'jsonwebtoken'
import { verifyJWT } from '../server'
import { chatWorker } from '../chat-worker'
import { offlineQueue } from '../store/offline-queue'
import { messageStore } from '../store/message-store'

const startTime = Date.now()

// ─── JWT helper for protected health endpoints ───────────────────────────────
function requireAuth(req: Request, res: Response): boolean {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  try {
    verifyJWT(authHeader.slice(7))
    return true
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
    return false
  }
}

// ─── Public health check (minimal info) ───────────────────────────────────────

export const publicHealthRouter = Router()

publicHealthRouter.get('/', (_req: Request, res: Response) => {
  res.json({ status: 'ok' })
})

// ─── Protected health routes (JWT required) ──────────────────────────────────

export const protectedHealthRouter = Router()

protectedHealthRouter.get('/detailed', (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return
  const chatStats = chatWorker.getStats()
  const storeStats = messageStore.getStats()
  const mem = process.memoryUsage()
  const cpus = os.cpus()

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
      totalPending: offlineQueue.totalPending(),
    },

    system: {
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      cpuCount: cpus.length,
      loadAvg: os.loadavg(),
      totalMem: Math.round(os.totalmem() / 1024 / 1024),
      freeMem: Math.round(os.freemem() / 1024 / 1024),
    },

    memory: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      external: Math.round(mem.external / 1024 / 1024),
    },
  })
})

protectedHealthRouter.get('/metrics', (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return
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

// Default export for backward compat (public only)
export default publicHealthRouter
