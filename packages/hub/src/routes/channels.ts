/**
 * routes/channels.ts — Hub channel management routes
 *
 * SECURITY: all routes require admin role.
 * callbackUrl is never exposed in responses.
 */

import { Router, Request, Response } from 'express'
import axios from 'axios'
import { getAllNodes } from '../store/nodes'
import { requireAdmin, getRequester } from './rbac-helpers'

const router = Router()

// ─── GET /api/channels ────────────────────────────────────────────────────────
// Admin only. Aggregate channel lists from all registered nodes.
// SECURITY: callbackUrl stripped from response.

router.get('/', (req: Request, res: Response): void => {
  if (!requireAdmin(req, res)) return

  void (async () => {
    const nodes = getAllNodes()

    const results = await Promise.all(nodes.map(async (node) => {
      if (!node.callbackUrl) {
        return { nodeId: node.nodeId, name: node.name, channels: [], error: 'no callbackUrl' }
      }
      try {
        const r = await axios.get<{ channels: unknown[] }>(`${node.callbackUrl}/api/channels`, { timeout: 3000 })
        return { nodeId: node.nodeId, name: node.name, channels: r.data?.channels ?? [] }
      } catch {
        return { nodeId: node.nodeId, name: node.name, channels: [], error: 'unreachable' }
      }
    }))

    res.json({ nodes: results })
  })()
})

// ─── POST /api/channels/configure ────────────────────────────────────────────
// Admin only. Forward channel configuration to a specific node.

router.post('/configure', (req: Request, res: Response): void => {
  if (!requireAdmin(req, res)) return

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
// Admin only. Aggregate per-channel stats from all nodes.
// SECURITY: callbackUrl stripped from response.

router.get('/stats', (req: Request, res: Response): void => {
  if (!requireAdmin(req, res)) return

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
