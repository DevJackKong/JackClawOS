export type AlertSeverity = 'info' | 'warning' | 'critical'
export type AlertChannel = 'log' | 'webhook' | 'console'

export interface SystemSnapshot {
  timestamp?: number
  metrics?: {
    success_rate?: number
    successRate?: number
    [key: string]: unknown
  }
  workload?: {
    queuedTasks?: number
    queued_tasks?: number
    [key: string]: unknown
  }
  memory?: {
    staleRate?: number
    stale_rate?: number
    staleCount?: number
    totalCount?: number
    [key: string]: unknown
  }
  agents?: Array<{
    id?: string
    healthy?: boolean
    status?: string
    [key: string]: unknown
  }>
  health?: {
    healthyAgents?: number
    totalAgents?: number
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface AlertRule {
  id: string
  name: string
  description: string
  condition: (snapshot: SystemSnapshot) => boolean
  severity: AlertSeverity
  cooldownMs: number
  channels: AlertChannel[]
}

export interface Alert {
  id: string
  ruleId: string
  ruleName: string
  severity: AlertSeverity
  message: string
  triggeredAt: number
  resolvedAt?: number
  metadata?: Record<string, unknown>
}

interface AlertState {
  alert: Alert
  lastTriggeredAt: number
}

const DEFAULT_COOLDOWN_MS = 300_000

export class AlertManager {
  private readonly rules = new Map<string, AlertRule>()
  private readonly activeAlerts = new Map<string, AlertState>()
  private readonly history: Alert[] = []

  constructor() {
    this.setupDefaultRules()
  }

  registerRule(rule: AlertRule): void {
    this.rules.set(rule.id, {
      ...rule,
      cooldownMs: rule.cooldownMs > 0 ? rule.cooldownMs : DEFAULT_COOLDOWN_MS,
      channels: rule.channels.length > 0 ? [...rule.channels] : ['log'],
    })
  }

  check(snapshot: SystemSnapshot): Alert[] {
    const now = this.getSnapshotTimestamp(snapshot)
    const triggered: Alert[] = []

    for (const rule of this.rules.values()) {
      const matched = this.safeEvaluate(rule, snapshot)
      const existing = this.activeAlerts.get(rule.id)

      if (!matched) {
        if (existing && !existing.alert.resolvedAt) {
          existing.alert.resolvedAt = now
          this.history.push({ ...existing.alert })
          this.activeAlerts.delete(rule.id)
        }
        continue
      }

      if (existing && now - existing.lastTriggeredAt < rule.cooldownMs) {
        continue
      }

      const alert: Alert = {
        id: this.createAlertId(rule.id, now),
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        message: `${rule.name}: ${rule.description}`,
        triggeredAt: now,
        metadata: this.buildMetadata(rule, snapshot),
      }

      this.activeAlerts.set(rule.id, { alert, lastTriggeredAt: now })
      this.history.push({ ...alert })
      this.dispatch(alert, rule.channels)
      triggered.push(alert)
    }

    return triggered
  }

  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values())
      .map(state => ({ ...state.alert }))
      .sort((a, b) => b.triggeredAt - a.triggeredAt)
  }

  getHistory(limit?: number): Alert[] {
    const records = [...this.history].sort((a, b) => b.triggeredAt - a.triggeredAt)
    if (!limit || limit <= 0) return records
    return records.slice(0, limit)
  }

  private setupDefaultRules(): void {
    this.registerRule({
      id: 'agent-success-rate-low',
      name: 'Agent 成功率过低',
      description: 'Agent 成功率低于 40%',
      condition: snapshot => this.getSuccessRate(snapshot) < 0.4,
      severity: 'critical',
      cooldownMs: DEFAULT_COOLDOWN_MS,
      channels: ['log', 'console'],
    })

    this.registerRule({
      id: 'task-queue-backlog-high',
      name: '任务队列积压',
      description: '任务队列积压超过 100',
      condition: snapshot => this.getQueuedTasks(snapshot) > 100,
      severity: 'warning',
      cooldownMs: DEFAULT_COOLDOWN_MS,
      channels: ['log', 'console'],
    })

    this.registerRule({
      id: 'memory-stale-rate-high',
      name: '记忆过期率过高',
      description: '记忆 stale 率超过 50%',
      condition: snapshot => this.getMemoryStaleRate(snapshot) > 0.5,
      severity: 'warning',
      cooldownMs: DEFAULT_COOLDOWN_MS,
      channels: ['log', 'console'],
    })

    this.registerRule({
      id: 'no-healthy-agents',
      name: '无健康 Agent',
      description: '系统当前没有健康 Agent',
      condition: snapshot => this.getHealthyAgentCount(snapshot) === 0,
      severity: 'critical',
      cooldownMs: DEFAULT_COOLDOWN_MS,
      channels: ['log', 'console'],
    })
  }

  private safeEvaluate(rule: AlertRule, snapshot: SystemSnapshot): boolean {
    try {
      return rule.condition(snapshot)
    } catch {
      return false
    }
  }

  private dispatch(alert: Alert, channels: AlertChannel[]): void {
    const line = `[alert:${alert.severity}] ${alert.ruleName} - ${alert.message}`

    if (channels.includes('console')) {
      console.error(line)
    }

    if (channels.includes('log')) {
      console.log(line)
    }

    if (channels.includes('webhook')) {
      console.warn(`[alert:webhook] not configured for alert ${alert.id}`)
    }
  }

  private buildMetadata(rule: AlertRule, snapshot: SystemSnapshot): Record<string, unknown> {
    return {
      ruleId: rule.id,
      severity: rule.severity,
      successRate: this.getSuccessRate(snapshot),
      queuedTasks: this.getQueuedTasks(snapshot),
      memoryStaleRate: this.getMemoryStaleRate(snapshot),
      healthyAgentCount: this.getHealthyAgentCount(snapshot),
      snapshotTimestamp: this.getSnapshotTimestamp(snapshot),
    }
  }

  private getSnapshotTimestamp(snapshot: SystemSnapshot): number {
    return typeof snapshot.timestamp === 'number' ? snapshot.timestamp : Date.now()
  }

  private getSuccessRate(snapshot: SystemSnapshot): number {
    return this.normalizeRate(snapshot.metrics?.success_rate ?? snapshot.metrics?.successRate)
  }

  private getQueuedTasks(snapshot: SystemSnapshot): number {
    const value = snapshot.workload?.queuedTasks ?? snapshot.workload?.queued_tasks
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
  }

  private getMemoryStaleRate(snapshot: SystemSnapshot): number {
    const directRate = snapshot.memory?.staleRate ?? snapshot.memory?.stale_rate
    if (typeof directRate === 'number' && Number.isFinite(directRate)) {
      return this.normalizeRate(directRate)
    }

    const staleCount = snapshot.memory?.staleCount
    const totalCount = snapshot.memory?.totalCount
    if (
      typeof staleCount === 'number' && Number.isFinite(staleCount) &&
      typeof totalCount === 'number' && Number.isFinite(totalCount) &&
      totalCount > 0
    ) {
      return staleCount / totalCount
    }

    return 0
  }

  private getHealthyAgentCount(snapshot: SystemSnapshot): number {
    const fromHealth = snapshot.health?.healthyAgents
    if (typeof fromHealth === 'number' && Number.isFinite(fromHealth)) {
      return Math.max(0, fromHealth)
    }

    if (Array.isArray(snapshot.agents)) {
      return snapshot.agents.filter(agent => {
        if (typeof agent.healthy === 'boolean') return agent.healthy
        if (typeof agent.status === 'string') return agent.status === 'healthy'
        return false
      }).length
    }

    return 0
  }

  private normalizeRate(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0
    if (value > 1) return value / 100
    if (value < 0) return 0
    return value
  }

  private createAlertId(ruleId: string, ts: number): string {
    return `alert-${ruleId}-${ts}-${Math.random().toString(36).slice(2, 8)}`
  }
}
