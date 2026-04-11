import fs from 'fs'
import path from 'path'

export interface OptimizerSummary {
  totalTasks: number
  completedTasks: number
  failedTasks: number
  completionRate: number
  memoryHitRate: number
  repeatedFailureTaskCount: number
}

export interface FailurePattern {
  pattern: string
  count: number
  tasks: string[]
}

export interface OptimizerReport {
  summary: OptimizerSummary
  failurePatterns: FailurePattern[]
  recommendations: string[]
  generatedAt: string
}

interface ParsedLogEntry {
  raw: string
  level: string
  status: 'completed' | 'failed' | 'unknown'
  taskId?: string
  taskName: string
  memoryHit: boolean
  failureReasons: string[]
}

export class ReportGenerator {
  generate(logPath: string): OptimizerReport {
    const resolvedPath = path.resolve(logPath)
    const content = fs.existsSync(resolvedPath) ? fs.readFileSync(resolvedPath, 'utf8') : ''
    const entries = this.parseLog(content)

    const totalTasks = entries.length
    const completedTasks = entries.filter(entry => entry.status === 'completed').length
    const failedTasks = entries.filter(entry => entry.status === 'failed').length
    const memoryHits = entries.filter(entry => entry.memoryHit).length
    const memoryHitRate = totalTasks > 0 ? memoryHits / totalTasks : 0

    const repeatedFailures = this.findRepeatedFailures(entries)
    const failurePatterns = this.collectFailurePatterns(entries, repeatedFailures)

    return {
      summary: {
        totalTasks,
        completedTasks,
        failedTasks,
        completionRate: totalTasks > 0 ? completedTasks / totalTasks : 0,
        memoryHitRate,
        repeatedFailureTaskCount: repeatedFailures.size,
      },
      failurePatterns,
      recommendations: this.buildRecommendations({
        totalTasks,
        failedTasks,
        memoryHitRate,
        repeatedFailures,
        failurePatterns,
      }),
      generatedAt: new Date().toISOString(),
    }
  }

  saveReport(report: OptimizerReport, outputPath: string): void {
    const resolvedPath = path.resolve(outputPath)
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true })
    fs.writeFileSync(resolvedPath, JSON.stringify(report, null, 2), 'utf8')
  }

  private parseLog(content: string): ParsedLogEntry[] {
    return content
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => this.parseLine(line))
  }

  private parseLine(line: string): ParsedLogEntry {
    const parts = line.split('|').map(part => part.trim())
    const taskId = parts[0] && /^L\d+/i.test(parts[0]) ? parts[0] : undefined
    const level = taskId ?? 'UNKNOWN'
    const detailParts = taskId ? parts.slice(1) : parts
    const normalized = line.toLowerCase()

    const status = this.detectStatus(normalized, detailParts)
    const taskName = this.extractTaskName(detailParts, line)
    const memoryHit = /(memory hit|命中记忆|记忆命中|cache hit|retrieved memory)/i.test(line)
    const failureReasons = this.extractFailureReasons(line, taskName)

    return {
      raw: line,
      level,
      status,
      taskId,
      taskName,
      memoryHit,
      failureReasons,
    }
  }

  private detectStatus(normalized: string, parts: string[]): 'completed' | 'failed' | 'unknown' {
    if (parts.some(part => /✅|完成|success|done|passed/.test(part.toLowerCase())) || /✅|完成|success|done|passed/.test(normalized)) {
      return 'completed'
    }
    if (parts.some(part => /❌|失败|fail|error|timeout|rejected/.test(part.toLowerCase())) || /❌|失败|fail|error|timeout|rejected/.test(normalized)) {
      return 'failed'
    }
    return 'unknown'
  }

  private extractTaskName(parts: string[], fallback: string): string {
    const candidate = [...parts].reverse().find(part => part.length > 0 && !/^(✅|❌|完成|失败|success|done|failed|error)$/i.test(part))
    return candidate ?? fallback
  }

  private extractFailureReasons(line: string, taskName: string): string[] {
    const reasons: string[] = []
    const normalized = line.toLowerCase()

    const patterns: Array<[RegExp, string]> = [
      [/(timeout|超时)/i, 'timeout'],
      [/(permission|unauthorized|forbidden|权限)/i, 'permission'],
      [/(memory miss|missed memory|未命中记忆|记忆未命中|cache miss)/i, 'memory_miss'],
      [/(network|fetch failed|socket|dns|连接失败|网络)/i, 'network'],
      [/(parse|json|syntax|格式错误|解析失败)/i, 'parse_error'],
      [/(retry|重试)/i, 'retry_loop'],
      [/(approve|approval|审核|审批)/i, 'approval_blocked'],
    ]

    for (const [pattern, label] of patterns) {
      if (pattern.test(normalized)) {
        reasons.push(label)
      }
    }

    if (reasons.length === 0 && /(❌|失败|fail|error)/i.test(line)) {
      reasons.push(`task_failure:${taskName}`)
    }

    return [...new Set(reasons)]
  }

  private findRepeatedFailures(entries: ParsedLogEntry[]): Map<string, number> {
    const failureCounts = new Map<string, number>()

    for (const entry of entries) {
      if (entry.status !== 'failed') continue
      const key = entry.taskName
      failureCounts.set(key, (failureCounts.get(key) ?? 0) + 1)
    }

    return new Map(
      Array.from(failureCounts.entries()).filter(([, count]) => count > 1),
    )
  }

  private collectFailurePatterns(entries: ParsedLogEntry[], repeatedFailures: Map<string, number>): FailurePattern[] {
    const patternMap = new Map<string, Set<string>>()

    for (const entry of entries) {
      if (entry.status !== 'failed') continue

      for (const reason of entry.failureReasons) {
        if (!patternMap.has(reason)) {
          patternMap.set(reason, new Set())
        }
        patternMap.get(reason)?.add(entry.taskName)
      }
    }

    for (const [taskName] of repeatedFailures) {
      if (!patternMap.has('repeated_failure')) {
        patternMap.set('repeated_failure', new Set())
      }
      patternMap.get('repeated_failure')?.add(taskName)
    }

    return Array.from(patternMap.entries())
      .map(([pattern, tasks]) => ({
        pattern,
        count: tasks.size,
        tasks: Array.from(tasks),
      }))
      .sort((a, b) => b.count - a.count)
  }

  private buildRecommendations(input: {
    totalTasks: number
    failedTasks: number
    memoryHitRate: number
    repeatedFailures: Map<string, number>
    failurePatterns: FailurePattern[]
  }): string[] {
    const recommendations: string[] = []

    if (input.totalTasks === 0) {
      return ['日志为空，先接入任务执行日志后再生成优化报告。']
    }

    if (input.memoryHitRate < 0.5) {
      recommendations.push('记忆命中率偏低，建议增强任务标签、历史检索关键词和缓存索引。')
    }

    if (input.failedTasks / input.totalTasks > 0.3) {
      recommendations.push('失败率偏高，建议拆小任务粒度并增加执行前校验。')
    }

    if (input.repeatedFailures.size > 0) {
      recommendations.push(`存在重复失败任务：${Array.from(input.repeatedFailures.keys()).join('、')}，建议加入针对性回退策略。`)
    }

    if (input.failurePatterns.some(pattern => pattern.pattern === 'timeout')) {
      recommendations.push('检测到超时失败，建议缩短单次任务上下文并启用阶段性保存。')
    }

    if (input.failurePatterns.some(pattern => pattern.pattern === 'permission')) {
      recommendations.push('检测到权限问题，建议在执行前做权限探测或审批预检查。')
    }

    if (input.failurePatterns.some(pattern => pattern.pattern === 'memory_miss')) {
      recommendations.push('检测到记忆未命中，建议将失败反思写回记忆系统并优化召回规则。')
    }

    if (recommendations.length === 0) {
      recommendations.push('整体运行稳定，保持当前策略并持续观察新增失败模式。')
    }

    return recommendations
  }
}
