// GET /api/nodes - List all registered nodes (CEO only)
// JWT must have role === 'ceo'

import { Router, Request, Response } from 'express'
import { getAllNodes } from '../store/nodes'
import { getLastReportEntry } from '../store/reports'
import { getAlerts, getLatestSnapshot } from '@jackclaw/watchdog'

const router = Router()

router.get('/', (req: Request, res: Response): void => {
  // CEO-only check (role set on JWT by auth middleware)
  const { role } = (req as Request & { jwtPayload?: { nodeId: string; role: string } }).jwtPayload ?? {}
  if (role !== 'ceo') {
    res.status(403).json({ error: 'Access denied. CEO role required.' })
    return
  }

  const nodes = getAllNodes()

  const result = nodes.map(node => {
    const lastReport = getLastReportEntry(node.nodeId)
    const unackedAlerts = getAlerts(node.nodeId, { acknowledged: false })
    const snapshot = getLatestSnapshot(node.nodeId)

    return {
      nodeId: node.nodeId,
      name: node.name,
      role: node.role,
      registeredAt: node.registeredAt,
      lastReportAt: node.lastReportAt ?? null,
      lastReportSummary: lastReport?.summary ?? null,
      watchdogStatus: {
        unackedAlerts: unackedAlerts.length,
        criticalAlerts: unackedAlerts.filter(a => a.severity === 'critical').length,
        lastSnapshotAt: snapshot?.timestamp ?? null,
        memoryHash: snapshot?.memoryHash ?? null,
      },
    }
  })

  res.json({
    success: true,
    total: result.length,
    nodes: result,
  })
})

export default router
