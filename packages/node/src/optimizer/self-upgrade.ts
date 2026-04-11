import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

// 自我升级系统配置
export interface SelfUpgradeConfig {
  scanIntervalMs: number // 默认 30分钟
  memoryScoreThreshold: number // 低于此分数的记忆触发清理建议
  skillEvolutionThreshold: number // 高频流程连续成功次数
  reportOutputPath: string // 报告输出路径
  autoApplyPatches: boolean // 是否自动应用低风险 patch（默认 false）
}

// 升级循环状态
export interface UpgradeCycleState {
  lastRunAt: number
  totalCyclesRun: number
  totalPatchesProposed: number
  totalPatchesApplied: number
  lastReport?: string // 最近一次报告摘要
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

type TaskAggregate = {
  taskType: string
  total: number
  successes: number
  failures: number
  avgLatencyMs: number
  avgRetryCount: number
  currentSuccessStreak: number
}

const DEFAULT_CONFIG: SelfUpgradeConfig = {
  scanIntervalMs: 30 * 60 * 1000,
  memoryScoreThreshold: 0.6,
  skillEvolutionThreshold: 5,
  reportOutputPath: './self-upgrade-report.md',
  autoApplyPatches: false,
}

export class SelfUpgradeSystem {
  private readonly config: SelfUpgradeConfig
  private state: UpgradeCycleState = {
    lastRunAt: 0,
    totalCyclesRun: 0,
    totalPatchesProposed: 0,
    totalPatchesApplied: 0,
  }

  constructor(config: Partial<SelfUpgradeConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    }
  }

  async runCycle(data: {
    taskLogs: Array<{ taskType: string; success: boolean; retryCount: number; latencyMs: number }>
    memoryHits: Array<{ memoryId: string; hitCount: number; successRate: number; lastUsed: number }>
  }): Promise<{
    report: string
    proposedPatches: number
    recommendations: string[]
  }> {
    const now = Date.now()
    const taskLogs = Array.isArray(data.taskLogs) ? data.taskLogs : []
    const memoryHits = Array.isArray(data.memoryHits) ? data.memoryHits : []

    const taskStats = this.aggregateTaskLogs(taskLogs)
    const taskRecommendations = this.analyzeTasks(taskStats)
    const memoryRecommendations = this.analyzeMemory(memoryHits, now)
    const recommendations = [...taskRecommendations, ...memoryRecommendations]

    const proposedPatches = recommendations.filter((item) => item.startsWith('PATCH:')).length
    const appliedPatches = this.config.autoApplyPatches ? proposedPatches : 0

    const report = this.buildMarkdownReport({
      now,
      taskLogs,
      memoryHits,
      taskStats,
      recommendations,
      proposedPatches,
      appliedPatches,
    })

    await this.persistReport(report)

    this.state = {
      lastRunAt: now,
      totalCyclesRun: this.state.totalCyclesRun + 1,
      totalPatchesProposed: this.state.totalPatchesProposed + proposedPatches,
      totalPatchesApplied: this.state.totalPatchesApplied + appliedPatches,
      lastReport: this.summarizeReport(taskStats.length, memoryHits.length, proposedPatches, recommendations.length),
    }

    return {
      report,
      proposedPatches,
      recommendations,
    }
  }

  getState(): UpgradeCycleState {
    return { ...this.state }
  }

  getSummary(): string {
    const lastRun = this.state.lastRunAt > 0 ? new Date(this.state.lastRunAt).toISOString() : 'never'
    return [
      `self-upgrade cycles=${this.state.totalCyclesRun}`,
      `lastRun=${lastRun}`,
      `patches=${this.state.totalPatchesApplied}/${this.state.totalPatchesProposed}`,
      this.state.lastReport ? `report=${this.state.lastReport}` : undefined,
    ]
      .filter(Boolean)
      .join(' | ')
  }

  private aggregateTaskLogs(taskLogs: TaskLog[]): TaskAggregate[] {
    const groups = new Map<string, TaskLog[]>()

    for (const log of taskLogs) {
      const list = groups.get(log.taskType) ?? []
      list.push(log)
      groups.set(log.taskType, list)
    }

    return Array.from(groups.entries())
      .map(([taskType, logs]) => {
        const total = logs.length
        const successes = logs.filter((log) => log.success).length
        const failures = total - successes
        const avgLatencyMs = total > 0 ? Math.round(logs.reduce((sum, log) => sum + Math.max(0, log.latencyMs), 0) / total) : 0
        const avgRetryCount = total > 0 ? Number((logs.reduce((sum, log) => sum + Math.max(0, log.retryCount), 0) / total).toFixed(2)) : 0
        let currentSuccessStreak = 0

        for (let index = logs.length - 1; index >= 0; index -= 1) {
          if (!logs[index].success) break
          currentSuccessStreak += 1
        }

        return {
          taskType,
          total,
          successes,
          failures,
          avgLatencyMs,
          avgRetryCount,
          currentSuccessStreak,
        }
      })
      .sort((a, b) => b.total - a.total || a.taskType.localeCompare(b.taskType))
  }

  private analyzeTasks(taskStats: TaskAggregate[]): string[] {
    const recommendations: string[] = []

    for (const stat of taskStats) {
      const successRate = stat.total > 0 ? stat.successes / stat.total : 0

      if (stat.currentSuccessStreak >= this.config.skillEvolutionThreshold && stat.total >= this.config.skillEvolutionThreshold) {
        recommendations.push(
          `PATCH: task \`${stat.taskType}\` 已连续成功 ${stat.currentSuccessStreak} 次，建议沉淀为可复用技能/模板。`,
        )
      }

      if (successRate < 0.8 && stat.failures > 0) {
        recommendations.push(
          `PATCH: task \`${stat.taskType}\` 成功率 ${(successRate * 100).toFixed(1)}%，建议增加重试策略、输入校验或降级路径。`,
        )
      }

      if (stat.avgRetryCount >= 1.5) {
        recommendations.push(
          `优化 task \`${stat.taskType}\`：平均重试 ${stat.avgRetryCount} 次，建议收敛 prompt/参数，减少重复执行。`,
        )
      }

      if (stat.avgLatencyMs >= 5000) {
        recommendations.push(
          `优化 task \`${stat.taskType}\`：平均耗时 ${stat.avgLatencyMs}ms，建议缓存结果或拆分慢路径。`,
        )
      }
    }

    if (taskStats.length === 0) {
      recommendations.push('暂无 task 日志；建议先接入最小任务观测数据。')
    }

    return recommendations
  }

  private analyzeMemory(memoryHits: MemoryHit[], now: number): string[] {
    const recommendations: string[] = []

    for (const memory of memoryHits) {
      const freshnessDays = Math.max(0, (now - memory.lastUsed) / (24 * 60 * 60 * 1000))
      const normalizedHitScore = Math.min(memory.hitCount / 10, 1)
      const recencyScore = freshnessDays > 30 ? 0.1 : freshnessDays > 14 ? 0.4 : freshnessDays > 7 ? 0.7 : 1
      const score = Number((memory.successRate * 0.6 + normalizedHitScore * 0.2 + recencyScore * 0.2).toFixed(2))

      if (score < this.config.memoryScoreThreshold) {
        recommendations.push(
          `清理记忆建议：\`${memory.memoryId}\` 综合分 ${score} 低于阈值 ${this.config.memoryScoreThreshold}，可归档、重写或降权。`,
        )
      }

      if (memory.hitCount >= 8 && memory.successRate >= 0.9) {
        recommendations.push(
          `强化记忆建议：\`${memory.memoryId}\` 高频且高成功，适合提升优先级或固化为长期记忆。`,
        )
      }
    }

    if (memoryHits.length === 0) {
      recommendations.push('暂无 memory 命中数据；建议补充记忆命中率与最近使用时间。')
    }

    return recommendations
  }

  private buildMarkdownReport(input: {
    now: number
    taskLogs: TaskLog[]
    memoryHits: MemoryHit[]
    taskStats: TaskAggregate[]
    recommendations: string[]
    proposedPatches: number
    appliedPatches: number
  }): string {
    const lines: string[] = []
    lines.push('# Self Upgrade Report')
    lines.push('')
    lines.push(`- Generated At: ${new Date(input.now).toISOString()}`)
    lines.push(`- Task Logs: ${input.taskLogs.length}`)
    lines.push(`- Memory Hits: ${input.memoryHits.length}`)
    lines.push(`- Proposed Patches: ${input.proposedPatches}`)
    lines.push(`- Applied Patches: ${input.appliedPatches}`)
    lines.push(`- Auto Apply Patches: ${this.config.autoApplyPatches ? 'enabled' : 'disabled'}`)
    lines.push('')
    lines.push('## Task Overview')
    lines.push('')

    if (input.taskStats.length === 0) {
      lines.push('- No task statistics available.')
    } else {
      for (const stat of input.taskStats) {
        const successRate = stat.total > 0 ? ((stat.successes / stat.total) * 100).toFixed(1) : '0.0'
        lines.push(
          `- ${stat.taskType}: total=${stat.total}, successRate=${successRate}%, avgRetry=${stat.avgRetryCount}, avgLatency=${stat.avgLatencyMs}ms, streak=${stat.currentSuccessStreak}`,
        )
      }
    }

    lines.push('')
    lines.push('## Recommendations')
    lines.push('')

    if (input.recommendations.length === 0) {
      lines.push('- No recommendations.')
    } else {
      for (const recommendation of input.recommendations) {
        lines.push(`- ${recommendation}`)
      }
    }

    return `${lines.join('\n')}\n`
  }

  private summarizeReport(
    taskTypeCount: number,
    memoryCount: number,
    proposedPatches: number,
    recommendationCount: number,
  ): string {
    return `tasks=${taskTypeCount}, memory=${memoryCount}, patches=${proposedPatches}, recs=${recommendationCount}`
  }

  private async persistReport(report: string): Promise<void> {
    const outputPath = this.config.reportOutputPath
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, report, 'utf8')
  }
}
