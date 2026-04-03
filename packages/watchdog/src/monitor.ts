/**
 * WatchdogMonitor — 监督层核心
 *
 * 设计原则（来自 Messy Jobs 第6章）：
 *  "必须保留推翻 AI 决策的权力，而这个权力不能交给 AI 自己"
 *
 * 关键约束：
 *  - canModify() 始终返回 false，任何 Agent 调用均被拒绝
 *  - 告警只能由真人通过 humanAck 关闭
 *  - 策略变更全部写入隔离审计日志
 */

import * as crypto from 'crypto'
import {
  WatchdogEvent,
  WatchdogEventType,
  WatchdogPolicy,
  WatchdogSnapshot,
  AlertSeverity,
  GetAlertsOptions,
} from './types'
import {
  appendEvent,
  appendPolicyAudit,
  readEvents,
  saveSnapshot,
  loadSnapshot,
  listSnapshotIds,
  updateEvent,
} from './isolation'

// ─── In-memory policy store (policies themselves aren't sensitive logs) ──────

const policies: Map<string, WatchdogPolicy> = new Map()

function policyKey(watcherHandle: string, targetHandle: string): string {
  return `${watcherHandle}::${targetHandle}`
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * 始终返回 false — Agent 无法通过此检查修改 Watchdog
 */
export function canModify(): false {
  return false
}

/**
 * 添加监督策略
 * 变更写入隔离审计日志
 */
export function addPolicy(policy: WatchdogPolicy): void {
  const key = policyKey(policy.watcherHandle, policy.targetHandle)
  policies.set(key, policy)

  appendPolicyAudit({
    action: 'add_policy',
    watcherHandle: policy.watcherHandle,
    targetHandle: policy.targetHandle,
    scope: policy.scope,
    permissions: policy.permissions,
  })
}

/**
 * 移除监督策略
 * 变更写入隔离审计日志
 */
export function removePolicy(watcherHandle: string, targetHandle: string): boolean {
  const key = policyKey(watcherHandle, targetHandle)
  const existed = policies.has(key)

  if (existed) {
    const policy = policies.get(key)!
    policy.revokedAt = Date.now()
    policies.delete(key)

    appendPolicyAudit({
      action: 'remove_policy',
      watcherHandle,
      targetHandle,
    })
  }

  return existed
}

/**
 * 获取节点的所有有效策略
 */
export function getPolicies(nodeId: string): WatchdogPolicy[] {
  return Array.from(policies.values()).filter(
    p => p.targetHandle === nodeId && !p.revokedAt
  )
}

/**
 * 拍摄节点状态快照（供后续对比检测异常）
 * tasks / trustScores 由调用方注入（Watchdog 不主动拉取，保持隔离）
 */
export function takeSnapshot(
  nodeId: string,
  tasks: unknown[],
  memoryContent: string,
  trustScores: Record<string, number>
): WatchdogSnapshot {
  const snapshot: WatchdogSnapshot = {
    nodeId,
    snapshotId: crypto.randomUUID(),
    tasks,
    memoryHash: crypto.createHash('sha256').update(memoryContent).digest('hex'),
    trustScores,
    timestamp: Date.now(),
  }

  saveSnapshot(snapshot)
  return snapshot
}

/**
 * 对比两个快照，返回检测到的异常事件列表（未写入日志，仅返回）
 * 调用方决定是否 raiseAlert
 */
export function compareSnapshots(
  watcherNodeId: string,
  a: WatchdogSnapshot,
  b: WatchdogSnapshot
): Omit<WatchdogEvent, 'id' | 'timestamp' | 'acknowledged'>[] {
  if (a.nodeId !== b.nodeId) {
    throw new Error('Cannot compare snapshots from different nodes')
  }

  const anomalies: Omit<WatchdogEvent, 'id' | 'timestamp' | 'acknowledged'>[] = []
  const nodeId = a.nodeId

  // Memory hash changed
  if (a.memoryHash !== b.memoryHash) {
    anomalies.push({
      type: 'memory_anomaly',
      severity: 'warning',
      nodeId,
      watcherNodeId,
      description: `Memory hash changed between snapshots ${a.snapshotId} → ${b.snapshotId}`,
      evidence: {
        prevHash: a.memoryHash,
        newHash: b.memoryHash,
        prevSnapshotId: a.snapshotId,
        newSnapshotId: b.snapshotId,
      },
    })
  }

  // Trust score drops
  for (const [peer, prevScore] of Object.entries(a.trustScores)) {
    const newScore = b.trustScores[peer]
    if (newScore !== undefined && newScore < prevScore - 0.2) {
      anomalies.push({
        type: 'trust_drop',
        severity: newScore < 0.3 ? 'critical' : 'warning',
        nodeId,
        watcherNodeId,
        description: `Trust score for peer "${peer}" dropped: ${prevScore.toFixed(2)} → ${newScore.toFixed(2)}`,
        evidence: { peer, prevScore, newScore },
      })
    }
  }

  // Task count sudden drop (potential task_deviation)
  if (b.tasks.length < a.tasks.length * 0.5 && a.tasks.length > 2) {
    anomalies.push({
      type: 'task_deviation',
      severity: 'warning',
      nodeId,
      watcherNodeId,
      description: `Task count dropped significantly: ${a.tasks.length} → ${b.tasks.length}`,
      evidence: { prevCount: a.tasks.length, newCount: b.tasks.length },
    })
  }

  return anomalies
}

/**
 * 触发告警 — 写入隔离日志，不可被 Agent 删除
 */
export function raiseAlert(
  partial: Omit<WatchdogEvent, 'id' | 'timestamp' | 'acknowledged'>
): WatchdogEvent {
  const event: WatchdogEvent = {
    ...partial,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    acknowledged: false,
  }

  appendEvent(event.nodeId, event)
  return event
}

/**
 * 真人确认告警 — humanId 必须由调用方验证为真人 token
 * Agent 调用此函数时应在路由层被 human-token 中间件拦截
 */
export function humanAck(eventId: string, nodeId: string, humanId: string): boolean {
  const events = readEvents(nodeId)
  const event = events.find(e => e.id === eventId)
  if (!event) return false
  if (event.acknowledged) return true // already acked

  const updated: WatchdogEvent = {
    ...event,
    acknowledged: true,
    acknowledgedBy: humanId,
  }

  return updateEvent(nodeId, updated)
}

/**
 * 查询告警（支持过滤）
 */
export function getAlerts(nodeId: string, opts: GetAlertsOptions = {}): WatchdogEvent[] {
  let events = readEvents(nodeId)

  if (opts.severity !== undefined) {
    events = events.filter(e => e.severity === opts.severity)
  }
  if (opts.acknowledged !== undefined) {
    events = events.filter(e => e.acknowledged === opts.acknowledged)
  }
  if (opts.since !== undefined) {
    events = events.filter(e => e.timestamp >= opts.since!)
  }

  // Sort descending by timestamp
  events.sort((a, b) => b.timestamp - a.timestamp)

  if (opts.limit !== undefined) {
    events = events.slice(0, opts.limit)
  }

  return events
}

/**
 * 获取节点最新快照
 */
export function getLatestSnapshot(nodeId: string): WatchdogSnapshot | null {
  const ids = listSnapshotIds(nodeId)
  if (ids.length === 0) return null
  return loadSnapshot(nodeId, ids[0])
}

// ─── WatchdogMonitor class (OOP facade for HTTP routes) ──────────────────────

export class WatchdogMonitor {
  canModify(): false { return canModify() }
  addPolicy(policy: WatchdogPolicy): void { addPolicy(policy) }
  removePolicy(watcherHandle: string, targetHandle: string): boolean {
    return removePolicy(watcherHandle, targetHandle)
  }
  takeSnapshot(
    nodeId: string,
    tasks: unknown[],
    memoryContent: string,
    trustScores: Record<string, number>
  ): WatchdogSnapshot {
    return takeSnapshot(nodeId, tasks, memoryContent, trustScores)
  }
  compareSnapshots(
    watcherNodeId: string,
    a: WatchdogSnapshot,
    b: WatchdogSnapshot
  ): Omit<WatchdogEvent, 'id' | 'timestamp' | 'acknowledged'>[] {
    return compareSnapshots(watcherNodeId, a, b)
  }
  raiseAlert(partial: Omit<WatchdogEvent, 'id' | 'timestamp' | 'acknowledged'>): WatchdogEvent {
    return raiseAlert(partial)
  }
  humanAck(eventId: string, nodeId: string, humanId: string): boolean {
    return humanAck(eventId, nodeId, humanId)
  }
  getAlerts(nodeId: string, opts?: GetAlertsOptions): WatchdogEvent[] {
    return getAlerts(nodeId, opts)
  }
  getLatestSnapshot(nodeId: string): WatchdogSnapshot | null {
    return getLatestSnapshot(nodeId)
  }
  getPolicies(nodeId: string): WatchdogPolicy[] {
    return getPolicies(nodeId)
  }
}
