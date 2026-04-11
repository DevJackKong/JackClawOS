/**
 * Task Metrics — 任务指标采集模块
 *
 * 记录任务执行结果，并输出聚合统计：
 * - success_rate
 * - avg_latency
 * - avg_retries
 * - top_memory_hits
 */

export interface TaskMetrics {
  task_id: string
  success: boolean
  user_satisfied: boolean
  tool_errors: number
  retry_count: number
  latency_sec: number
  memory_hit: string[]
}

export interface TaskMetricsStats {
  total_tasks: number
  success_count: number
  success_rate: number
  avg_latency: number
  avg_retries: number
  total_tool_errors: number
  user_satisfaction_rate: number
  top_memory_hits: Array<{
    key: string
    count: number
  }>
}

export class MetricsCollector {
  private readonly records: TaskMetrics[] = []

  record(metrics: TaskMetrics): void {
    this.records.push({
      task_id: metrics.task_id,
      success: metrics.success,
      user_satisfied: metrics.user_satisfied,
      tool_errors: metrics.tool_errors,
      retry_count: metrics.retry_count,
      latency_sec: metrics.latency_sec,
      memory_hit: [...metrics.memory_hit],
    })
  }

  getStats(): TaskMetricsStats {
    const total_tasks = this.records.length

    if (total_tasks === 0) {
      return {
        total_tasks: 0,
        success_count: 0,
        success_rate: 0,
        avg_latency: 0,
        avg_retries: 0,
        total_tool_errors: 0,
        user_satisfaction_rate: 0,
        top_memory_hits: [],
      }
    }

    const success_count = this.records.filter(record => record.success).length
    const satisfied_count = this.records.filter(record => record.user_satisfied).length
    const total_latency = this.records.reduce((sum, record) => sum + record.latency_sec, 0)
    const total_retries = this.records.reduce((sum, record) => sum + record.retry_count, 0)
    const total_tool_errors = this.records.reduce((sum, record) => sum + record.tool_errors, 0)

    const memoryHitCounter = new Map<string, number>()
    for (const record of this.records) {
      for (const hit of record.memory_hit) {
        memoryHitCounter.set(hit, (memoryHitCounter.get(hit) ?? 0) + 1)
      }
    }

    const top_memory_hits = Array.from(memoryHitCounter.entries())
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1]
        return a[0].localeCompare(b[0])
      })
      .map(([key, count]) => ({ key, count }))

    return {
      total_tasks,
      success_count,
      success_rate: success_count / total_tasks,
      avg_latency: total_latency / total_tasks,
      avg_retries: total_retries / total_tasks,
      total_tool_errors,
      user_satisfaction_rate: satisfied_count / total_tasks,
      top_memory_hits,
    }
  }

  exportJson(): string {
    return JSON.stringify(
      {
        records: this.records,
        stats: this.getStats(),
      },
      null,
      2,
    )
  }
}
