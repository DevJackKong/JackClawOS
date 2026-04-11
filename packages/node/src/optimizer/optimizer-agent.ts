export interface OptimizationTarget {
  type: 'prompt' | 'memory' | 'routing' | 'skill' | 'sop'
  targetId: string
  issue: string
  suggestion: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  evidence: string[]
}

export interface OptimizationReport {
  generatedAt: number
  period: { from: number; to: number }
  targets: OptimizationTarget[]
  summary: string
  topIssues: string[]
}

type TaskLog = {
  taskType: string
  success: boolean
  retryCount: number
  latencyMs: number
}

type MemoryHit = {
  memoryId: string
  hitCount: number
  successRate: number
  lastUsed: number
}

export class OptimizerAgent {
  private lastTaskTargets: OptimizationTarget[] = []
  private lastMemoryTargets: OptimizationTarget[] = []

  scanTaskLogs(logs: TaskLog[]): OptimizationTarget[] {
    const byTaskType = new Map<string, TaskLog[]>()

    for (const log of logs) {
      const group = byTaskType.get(log.taskType) ?? []
      group.push(log)
      byTaskType.set(log.taskType, group)
    }

    const targets: OptimizationTarget[] = []

    for (const [taskType, group] of byTaskType.entries()) {
      const total = group.length
      if (total === 0) continue

      const failures = group.filter(log => !log.success).length
      const retries = group.reduce((sum, log) => sum + Math.max(0, log.retryCount), 0)
      const avgRetryCount = retries / total
      const avgLatencyMs = group.reduce((sum, log) => sum + Math.max(0, log.latencyMs), 0) / total
      const failureRate = failures / total
      const highLatencyCount = group.filter(log => log.latencyMs >= 15000).length

      if (failureRate >= 0.5) {
        targets.push({
          type: 'prompt',
          targetId: taskType,
          issue: '任务失败率过高',
          suggestion: '重写任务提示词，补充输入约束、成功标准与错误恢复步骤。',
          priority: failureRate >= 0.75 ? 'critical' : 'high',
          evidence: [
            `taskType=${taskType}`,
            `failureRate=${(failureRate * 100).toFixed(1)}%`,
            `failures=${failures}/${total}`,
          ],
        })
      }

      if (avgRetryCount >= 2) {
        targets.push({
          type: 'sop',
          targetId: taskType,
          issue: '重复重试过多，说明执行流程不稳定',
          suggestion: '为该任务建立标准操作流程，前置校验依赖、权限和输入完整性。',
          priority: avgRetryCount >= 3 ? 'high' : 'medium',
          evidence: [
            `taskType=${taskType}`,
            `avgRetryCount=${avgRetryCount.toFixed(2)}`,
            `totalRetries=${retries}`,
          ],
        })
      }

      if (avgLatencyMs >= 10000 || highLatencyCount / total >= 0.4) {
        targets.push({
          type: 'routing',
          targetId: taskType,
          issue: '任务平均延迟偏高',
          suggestion: '调整模型或执行路径路由，将高延迟任务分流到更合适的模型/技能。',
          priority: avgLatencyMs >= 20000 ? 'high' : 'medium',
          evidence: [
            `taskType=${taskType}`,
            `avgLatencyMs=${Math.round(avgLatencyMs)}`,
            `highLatencyCount=${highLatencyCount}/${total}`,
          ],
        })
      }
    }

    this.lastTaskTargets = this.deduplicateAndSort(targets)
    return [...this.lastTaskTargets]
  }

  scanMemoryHits(hits: MemoryHit[]): OptimizationTarget[] {
    const now = Date.now()
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000
    const targets: OptimizationTarget[] = []

    for (const hit of hits) {
      const ageMs = Math.max(0, now - hit.lastUsed)
      const stale = ageMs >= ninetyDaysMs
      const lowHitCount = hit.hitCount <= 1
      const lowSuccess = hit.successRate < 0.5

      if (stale && (lowHitCount || lowSuccess)) {
        targets.push({
          type: 'memory',
          targetId: hit.memoryId,
          issue: '记忆长期未使用且效果差',
          suggestion: '降级、归档或删除该记忆，并补充更近期、更高质量的替代记忆。',
          priority: lowSuccess && stale ? 'high' : 'medium',
          evidence: [
            `memoryId=${hit.memoryId}`,
            `hitCount=${hit.hitCount}`,
            `successRate=${(hit.successRate * 100).toFixed(1)}%`,
            `daysSinceLastUsed=${Math.floor(ageMs / (24 * 60 * 60 * 1000))}`,
          ],
        })
      } else if (hit.hitCount >= 20 && hit.successRate < 0.6) {
        targets.push({
          type: 'memory',
          targetId: hit.memoryId,
          issue: '高频记忆命中后成功率仍偏低',
          suggestion: '重写记忆内容，压缩噪音信息，保留可直接提升任务成功率的关键信息。',
          priority: hit.successRate < 0.4 ? 'high' : 'medium',
          evidence: [
            `memoryId=${hit.memoryId}`,
            `hitCount=${hit.hitCount}`,
            `successRate=${(hit.successRate * 100).toFixed(1)}%`,
            `lastUsed=${hit.lastUsed}`,
          ],
        })
      }
    }

    this.lastMemoryTargets = this.deduplicateAndSort(targets)
    return [...this.lastMemoryTargets]
  }

  generateReport(period?: { from: number; to: number }): OptimizationReport {
    const now = Date.now()
    const resolvedPeriod = period ?? {
      from: now - 7 * 24 * 60 * 60 * 1000,
      to: now,
    }

    const targets = this.deduplicateAndSort([
      ...this.lastTaskTargets,
      ...this.lastMemoryTargets,
    ])

    const summary = this.buildSummary(targets)
    const topIssues = targets.slice(0, 5).map(target => `${target.targetId}: ${target.issue}`)

    return {
      generatedAt: now,
      period: resolvedPeriod,
      targets,
      summary,
      topIssues,
    }
  }

  formatReport(report: OptimizationReport): string {
    const lines: string[] = []
    lines.push('# Optimization Report')
    lines.push('')
    lines.push(`- Generated At: ${new Date(report.generatedAt).toISOString()}`)
    lines.push(`- Period: ${new Date(report.period.from).toISOString()} ~ ${new Date(report.period.to).toISOString()}`)
    lines.push(`- Total Targets: ${report.targets.length}`)
    lines.push('')
    lines.push('## Summary')
    lines.push(report.summary)
    lines.push('')
    lines.push('## Top Issues')

    if (report.topIssues.length === 0) {
      lines.push('- None')
    } else {
      for (const issue of report.topIssues) {
        lines.push(`- ${issue}`)
      }
    }

    lines.push('')
    lines.push('## Targets')

    if (report.targets.length === 0) {
      lines.push('- No optimization targets detected.')
      return lines.join('\n')
    }

    for (const target of report.targets) {
      lines.push(`### [${target.priority.toUpperCase()}] ${target.type}:${target.targetId}`)
      lines.push(`- Issue: ${target.issue}`)
      lines.push(`- Suggestion: ${target.suggestion}`)
      lines.push('- Evidence:')
      for (const item of target.evidence) {
        lines.push(`  - ${item}`)
      }
      lines.push('')
    }

    return lines.join('\n').trim()
  }

  private buildSummary(targets: OptimizationTarget[]): string {
    if (targets.length === 0) {
      return '未发现明显低效模式，当前任务执行与记忆利用整体稳定。'
    }

    const priorityCounts = targets.reduce<Record<OptimizationTarget['priority'], number>>(
      (acc, target) => {
        acc[target.priority] += 1
        return acc
      },
      { low: 0, medium: 0, high: 0, critical: 0 },
    )

    const typeCounts = targets.reduce<Record<OptimizationTarget['type'], number>>(
      (acc, target) => {
        acc[target.type] += 1
        return acc
      },
      { prompt: 0, memory: 0, routing: 0, skill: 0, sop: 0 },
    )

    const dominantType = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown'

    return `共识别 ${targets.length} 个优化目标，其中 critical ${priorityCounts.critical} 个、high ${priorityCounts.high} 个。主要瓶颈集中在 ${dominantType} 维度，建议优先处理高优先级问题。`
  }

  private deduplicateAndSort(targets: OptimizationTarget[]): OptimizationTarget[] {
    const priorityOrder: Record<OptimizationTarget['priority'], number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    }

    const unique = new Map<string, OptimizationTarget>()
    for (const target of targets) {
      const key = `${target.type}:${target.targetId}:${target.issue}`
      const existing = unique.get(key)
      if (!existing || priorityOrder[target.priority] < priorityOrder[existing.priority]) {
        unique.set(key, target)
      }
    }

    return [...unique.values()].sort((a, b) => {
      const priorityDelta = priorityOrder[a.priority] - priorityOrder[b.priority]
      if (priorityDelta !== 0) return priorityDelta
      if (a.type !== b.type) return a.type.localeCompare(b.type)
      return a.targetId.localeCompare(b.targetId)
    })
  }
}
