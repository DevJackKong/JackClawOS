/**
 * routes/channels.ts — Hub channel management routes
 *
 * Aggregates IM channel status and stats across all registered nodes,
 * and proxies channel configuration requests to individual nodes.
 */

import { Router, Request, Response } from 'express'
import axios from 'axios'
import { getAllNodes } from '../store/nodes'

const router = Router()

// ─── GET /api/channels ────────────────────────────────────────────────────────
// Aggregate channel lists from all registered nodes.

router.get('/', (req: Request, res: Response): void => {
  void (async () => {
    const nodes = getAllNodes()

    const results = await Promise.all(nodes.map(async (node) => {
      if (!node.callbackUrl) {
        return { nodeId: node.nodeId, name: node.name, callbackUrl: null, channels: [], error: 'no callbackUrl' }
      }
      try {
        const r = await axios.get<{ channels: unknown[] }>(`${node.callbackUrl}/api/channels`, { timeout: 3000 })
        return { nodeId: node.nodeId, name: node.name, callbackUrl: node.callbackUrl, channels: r.data?.channels ?? [] }
      } catch {
        return { nodeId: node.nodeId, name: node.name, callbackUrl: node.callbackUrl, channels: [], error: 'unreachable' }
      }
    }))

    res.json({ nodes: results })
  })()
})

// ─── POST /api/channels/configure ────────────────────────────────────────────
// Forward channel configuration to a specific node.

router.post('/configure', (req: Request, res: Response): void => {
  void (async () => {
    const { nodeId, channel, config } = req.body as {
      nodeId?: string
      channel?: string
      config?: Record<string, unknown>
    }

    if (!nodeId || !channel || !config) {
      res.status(400).json({ error: 'nodeId, channel, and config are required' })
      return
    }

    const nodes = getAllNodes()
    const node = nodes.find(n => n.nodeId === nodeId)
    if (!node) {
      res.status(404).json({ error: `Node not found: ${nodeId}` })
      return
    }
    if (!node.callbackUrl) {
      res.status(422).json({ error: `Node ${nodeId} has no callbackUrl` })
      return
    }

    try {
      const r = await axios.post(
        `${node.callbackUrl}/api/channels/configure`,
        { channel, config },
        { timeout: 5000 },
      )
      res.json(r.data)
    } catch (err: any) {
      const status = err?.response?.status ?? 502
      const message = err?.response?.data?.error ?? err?.message ?? 'Node unreachable'
      res.status(status).json({ error: message })
    }
  })()
})

// ─── GET /api/channels/stats ──────────────────────────────────────────────────
// Aggregate per-channel stats (messages sent/received, uptime) from all nodes.

router.get('/stats', (req: Request, res: Response): void => {
  void (async () => {
    const nodes = getAllNodes()

    const results = await Promise.all(nodes.map(async (node) => {
      if (!node.callbackUrl) {
        return { nodeId: node.nodeId, name: node.name, stats: null, error: 'no callbackUrl' }
      }
      try {
        const r = await axios.get<{
          stats: { total: number; byChannel: Record<string, unknown> }
        }>(`${node.callbackUrl}/api/channels/stats`, { timeout: 3000 })
        return { nodeId: node.nodeId, name: node.name, stats: r.data?.stats ?? null }
      } catch {
        return { nodeId: node.nodeId, name: node.name, stats: null, error: 'unreachable' }
      }
    }))

    res.json({ nodes: results })
  })()
})

export default router
