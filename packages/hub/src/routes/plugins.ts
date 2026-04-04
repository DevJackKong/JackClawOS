/**
 * Plugin Management API
 *
 * GET  /api/plugins         → list loaded plugins
 * GET  /api/plugins/stats   → plugin system stats
 * POST /api/plugins/events  → list recent events
 */

import { Router, Request, Response } from 'express'
import { pluginManager } from '../plugin-manager'
import { eventBus } from '../event-bus'

const router = Router()

// GET /api/plugins
router.get('/', (_req: Request, res: Response) => {
  res.json({
    plugins: pluginManager.list(),
    stats: pluginManager.getStats(),
  })
})

// GET /api/plugins/stats
router.get('/stats', (_req: Request, res: Response) => {
  res.json(pluginManager.getStats())
})

// GET /api/plugins/events
router.get('/events', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50
  const events = eventBus.getRecentEvents(limit)
  res.json({ events, count: events.length })
})

export default router
