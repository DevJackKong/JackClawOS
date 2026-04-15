// GET  /api/nodes                     - List all registered nodes (CEO only)
// POST /api/nodes/:nodeId/workload     - Node pushes workload snapshot (self or CEO)
// JWT must have role === 'ceo' for GET

import { Router, Request, Response } from 'express'
import { getAllNodes } from '../store/nodes'
import { getLastReportEntry } from '../store/reports'
import { getAlerts, getLatestSnapshot } from '@jackclaw/watchdog'
import { getWorkload, setWorkload, WorkloadSnapshot } from '../store/workload-cache'
import { heartbeatStore, resolveStatus } from './watchdog'

const router = Router()

router.get('/', (req: Request, res: Response): void => {
  // CEO-only check (role set on JWT by auth middleware)
  const { role } = (req as Request & { jwtPayload?: { nodeId: string; role: string } }).jwtPayload ?? {}
  if (role !== 'ceo' && role !== 'admin' && role !== 'owner') {
    res.status(403).json({ error: 'Access denied. CEO/admin role required.', code: 'FORBIDDEN' })
    return
  }

  try {
    const nodes = getAllNodes()

    const result = nodes.map(node => {
      const lastReport = getLastReportEntry(node.nodeId)
      const unackedAlerts = getAlerts(node.nodeId, { acknowledged: false })
      const snapshot = getLatestSnapshot(node.nodeId)

      const hb = heartbeatStore.get(node.nodeId)
      const healthMetrics = hb ? resolveStatus(hb) : null

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
        health: healthMetrics ? {
          status: healthMetrics.status,
          lastHeartbeat: healthMetrics.lastHeartbeat,
          memUsage: healthMetrics.metrics.memUsage,
          cpuLoad: healthMetrics.metrics.cpuLoad,
          uptime: healthMetrics.metrics.uptime,
          tasksCompleted: healthMetrics.metrics.tasksCompleted,
          lastTaskAt: healthMetrics.metrics.lastTaskAt,
        } : null,
        workload: getWorkload(node.nodeId),
      }
    })

    res.json({
      success: true,
      total: result.length,
      nodes: result,
    })
  } catch (err: any) {
    console.error('[nodes] Error:', err)
    res.status(500).json({ error: err.message || 'Failed to list nodes', code: 'INTERNAL_ERROR' })
  }
})

/**
 * POST /api/nodes/:nodeId/workload
 * Nodes push their latest workload snapshot.
 * A node may only push for itself (unless CEO).
 */
router.post('/:nodeId/workload', (req: Request, res: Response): void => {
  const jwtPayload = (req as Request & { jwtPayload?: { nodeId: string; role: string } }).jwtPayload ?? { nodeId: '', role: '' }
  const { nodeId } = req.params

  if (jwtPayload.role !== 'ceo' && jwtPayload.nodeId !== nodeId) {
    res.status(403).json({ error: 'Access denied. Can only push your own workload.', code: 'FORBIDDEN' })
    return
  }

  const body = req.body as Partial<WorkloadSnapshot>
  if (
    typeof body.activeTasks !== 'number' ||
    typeof body.queuedTasks !== 'number' ||
    typeof body.completedToday !== 'number'
  ) {
    res.status(400).json({ error: 'Missing required fields: activeTasks, queuedTasks, completedToday', code: 'VALIDATION_ERROR' })
    return
  }

  try {
    setWorkload(nodeId, { ...body, nodeId, updatedAt: body.updatedAt ?? Date.now() } as WorkloadSnapshot)
    res.json({ success: true })
  } catch (err: any) {
    console.error('[nodes] workload error:', err)
    res.status(500).json({ error: err.message || 'Failed to update workload', code: 'INTERNAL_ERROR' })
  }
})

export default router
