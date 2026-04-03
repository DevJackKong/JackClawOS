export type WatchdogEventType =
  | 'task_deviation'   // 任务执行偏离授权范围
  | 'memory_anomaly'   // memory 被异常修改
  | 'scope_violation'  // Agent 越权操作
  | 'trust_drop'       // 信任分数异常下降
  | 'collab_overstep'  // 协作超出约定范围
  | 'override_attempt' // Agent 尝试修改 Watchdog 规则（最高危）

export type AlertSeverity = 'info' | 'warning' | 'critical'

export interface WatchdogEvent {
  id: string
  type: WatchdogEventType
  severity: AlertSeverity
  nodeId: string          // 被监督的节点
  watcherNodeId: string   // 监督方节点
  description: string
  evidence: Record<string, unknown>
  timestamp: number
  acknowledged: boolean
  acknowledgedBy?: string // 只能是真人（通过 humanAck 接口）
}

export interface WatchdogPolicy {
  watcherHandle: string   // 谁在监督
  targetHandle: string    // 监督谁
  scope: 'self' | 'granted' // self=监督自己, granted=对方授权监督
  permissions: ('read_tasks' | 'read_memory' | 'read_collabs' | 'read_trust')[]
  alertChannels: ('feishu' | 'telegram' | 'webhook')[]
  webhookUrl?: string
  createdAt: number
  grantedAt?: number  // 对方授权时间
  revokedAt?: number  // 授权撤销时间
}

export interface WatchdogSnapshot {
  nodeId: string
  snapshotId: string
  tasks: unknown[]        // 当时任务状态快照
  memoryHash: string      // memory 内容的哈希
  trustScores: Record<string, number>
  timestamp: number
}

export interface GetAlertsOptions {
  severity?: AlertSeverity
  acknowledged?: boolean
  limit?: number
  since?: number
}
