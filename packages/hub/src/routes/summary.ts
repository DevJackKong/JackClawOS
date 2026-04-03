// GET /api/summary?date=YYYY-MM-DD - Aggregated daily summary
// Groups all node reports by role

import { Router, Request, Response } from 'express'
import { getAllNodeReportsForDate } from '../store/reports'
import { getAllNodes } from '../store/nodes'
import { SummaryResponse, RoleSummary } from '../types'

const router = Router()

router.get('/', (req: Request, res: Response): void => {
  const { date } = req.query as { date?: string }

  // Validate date format if provided
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' })
    return
  }

  const targetDate = date ?? new Date().toISOString().slice(0, 10)
  const allNodes = getAllNodes()
  const nodeMap = Object.fromEntries(allNodes.map(n => [n.nodeId, n]))

  const dailyReports = getAllNodeReportsForDate(targetDate)

  const byRole: Record<string, RoleSummary> = {}
  const reportingNodeIds = new Set<string>()

  for (const daily of dailyReports) {
    if (daily.reports.length === 0) continue

    const node = nodeMap[daily.nodeId]
    if (!node) continue

    const role = node.role
    if (!byRole[role]) {
      byRole[role] = { role, nodes: [] }
    }

    // Use the latest report entry for the day
    const latestReport = daily.reports[daily.reports.length - 1]

    // Respect visibility: private reports are excluded from summary
    if (latestReport.visibility === 'private') continue

    reportingNodeIds.add(daily.nodeId)
    byRole[role].nodes.push({
      nodeId: daily.nodeId,
      name: node.name,
      summary: latestReport.summary,
      period: latestReport.period,
      reportedAt: latestReport.timestamp,
    })
  }

  const response: SummaryResponse = {
    date: targetDate,
    byRole,
    totalNodes: allNodes.length,
    reportingNodes: reportingNodeIds.size,
  }

  res.json(response)
})

export default router
