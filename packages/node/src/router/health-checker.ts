export type AgentStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown'

export interface AgentHealthReport {
  agentId: string
  status: AgentStatus
  successRate: number
  avgLatencyMs: number
  recentFailureCount: number
  lastCheckedAt: number
  issues: string[]
  recommendation: string
}

export class AgentHealthChecker {
  thresholds = {
    minSuccessRate: 0.6,
    criticalSuccessRate: 0.3,
    maxAvgLatencyMs: 30000,
    maxRecentFailures: 5,
  }

  check(agentId: string, profile: any): AgentHealthReport {
    const metrics = profile?.metrics ?? {}
    const successRate = this.normalizeRate(metrics.successRate)
    const avgLatencyMs = this.normalizeCount(metrics.avgLatencyMs)
    const recentFailureCount = this.getRecentFailureCount(profile)
    const lastCheckedAt = Date.now()
    const issues: string[] = []

    if (!profile) {
      issues.push('agent profile missing')
    }

    if (!metrics || typeof metrics !== 'object') {
      issues.push('agent metrics missing')
    }

    const totalTasks = this.normalizeCount(metrics.totalTasks)
    if (totalTasks === 0) {
      issues.push('no task history available')
    }

    if (successRate <= this.thresholds.criticalSuccessRate) {
      issues.push(`critical success rate: ${this.formatPercent(successRate)}`)
    } else if (successRate < this.thresholds.minSuccessRate) {
      issues.push(`low success rate: ${this.formatPercent(successRate)}`)
    }

    if (avgLatencyMs > this.thresholds.maxAvgLatencyMs) {
      issues.push(`high average latency: ${Math.round(avgLatencyMs)}ms`)
    }

    if (recentFailureCount > this.thresholds.maxRecentFailures) {
      issues.push(`recent failures exceeded threshold: ${recentFailureCount}`)
    }

    const status = this.resolveStatus({
      hasProfile: !!profile,
      totalTasks,
      successRate,
      avgLatencyMs,
      recentFailureCount,
    })

    return {
      agentId,
      status,
      successRate,
      avgLatencyMs,
      recentFailureCount,
      lastCheckedAt,
      issues,
      recommendation: this.buildRecommendation(status, issues),
    }
  }

  checkAll(profiles: any[]): AgentHealthReport[] {
    return (profiles ?? []).map((profile, index) => {
      const agentId = this.resolveAgentId(profile, index)
      return this.check(agentId, profile)
    })
  }

  getUnhealthyAgents(profiles: any[]): AgentHealthReport[] {
    return this.checkAll(profiles).filter((report) => report.status === 'unhealthy')
  }

  formatReport(reports: AgentHealthReport[]): string {
    if (!reports || reports.length === 0) {
      return 'Agent Health Report\n(no agents checked)'
    }

    const lines = ['Agent Health Report']

    for (const report of reports) {
      const issueText = report.issues.length > 0 ? report.issues.join('; ') : 'none'
      lines.push(
        [
          `- ${report.agentId}`,
          `status=${report.status}`,
          `success=${this.formatPercent(report.successRate)}`,
          `latency=${Math.round(report.avgLatencyMs)}ms`,
          `recentFailures=${report.recentFailureCount}`,
          `issues=${issueText}`,
          `recommendation=${report.recommendation}`,
        ].join(' | '),
      )
    }

    return lines.join('\n')
  }

  private resolveStatus(input: {
    hasProfile: boolean
    totalTasks: number
    successRate: number
    avgLatencyMs: number
    recentFailureCount: number
  }): AgentStatus {
    if (!input.hasProfile || input.totalTasks === 0) {
      return 'unknown'
    }

    if (
      input.successRate <= this.thresholds.criticalSuccessRate ||
      input.recentFailureCount > this.thresholds.maxRecentFailures
    ) {
      return 'unhealthy'
    }

    if (
      input.successRate < this.thresholds.minSuccessRate ||
      input.avgLatencyMs > this.thresholds.maxAvgLatencyMs
    ) {
      return 'degraded'
    }

    return 'healthy'
  }

  private buildRecommendation(status: AgentStatus, issues: string[]): string {
    switch (status) {
      case 'healthy':
        return 'keep agent in normal rotation'
      case 'degraded':
        if (issues.some((issue) => issue.includes('latency'))) {
          return 'reduce load and investigate latency bottlenecks'
        }
        return 'monitor closely and rebalance traffic if needed'
      case 'unhealthy':
        return 'remove from rotation and investigate failures immediately'
      case 'unknown':
      default:
        return 'collect more execution data before routing critical tasks'
    }
  }

  private getRecentFailureCount(profile: any): number {
    const failureTypes = profile?.metrics?.failureTypes
    if (!failureTypes || typeof failureTypes !== 'object') {
      return 0
    }

    return Object.values(failureTypes).reduce((total, value) => total + this.normalizeCount(value), 0)
  }

  private resolveAgentId(profile: any, index: number): string {
    if (typeof profile?.agentId === 'string' && profile.agentId.trim()) {
      return profile.agentId
    }

    return `agent-${index + 1}`
  }

  private normalizeRate(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return 0
    }

    if (value < 0) return 0
    if (value > 1) return 1
    return value
  }

  private normalizeCount(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return 0
    }

    return Math.max(0, value)
  }

  private formatPercent(value: number): string {
    return `${Math.round(this.normalizeRate(value) * 100)}%`
  }
}
