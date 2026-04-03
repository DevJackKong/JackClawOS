// GET /api/nodes - List all registered nodes (CEO only)
// JWT must have role === 'ceo'

import { Router, Request, Response } from 'express'
import { getAllNodes } from '../store/nodes'
import { getLastReportEntry } from '../store/reports'

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
    return {
      nodeId: node.nodeId,
      name: node.name,
      role: node.role,
      registeredAt: node.registeredAt,
      lastReportAt: node.lastReportAt ?? null,
      lastReportSummary: lastReport?.summary ?? null,
    }
  })

  res.json({
    success: true,
    total: result.length,
    nodes: result,
  })
})

export default router
