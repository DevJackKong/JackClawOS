export interface MetricPoint {
  timestamp: number
  value: number
  label?: string
}

export interface MetricSeries {
  name: string
  unit: string
  points: MetricPoint[]
  trend: 'up' | 'down' | 'stable'
  changePercent: number
}

export interface DashboardPanel {
  id: string
  title: string
  type: 'line' | 'bar' | 'number' | 'table'
  series: MetricSeries[]
  description?: string
}

export interface DashboardData {
  title: string
  generatedAt: number
  period: { from: number; to: number }
  panels: DashboardPanel[]
  summary: {
    totalTasks: number
    successRate: number
    avgLatencyMs: number
    topFailureTypes: string[]
    memoryHitRate: number
    skillsActive: number
  }
}

export interface DashboardMetricInput {
  taskId: string
  success: boolean
  latencyMs: number
  retryCount: number
  memoryHits: string[]
  toolErrors: number
  timestamp: number
}

export class DashboardGenerator {
  generate(metrics: DashboardMetricInput[]): DashboardData {
    const sortedMetrics = [...metrics].sort((a, b) => a.timestamp - b.timestamp)
    const generatedAt = Date.now()

    if (sortedMetrics.length === 0) {
      return {
        title: 'Metrics Dashboard',
        generatedAt,
        period: { from: generatedAt, to: generatedAt },
        panels: [
          {
            id: 'success-rate',
            title: 'Success Rate',
            type: 'line',
            series: [],
            description: 'Task success rate over time',
          },
          {
            id: 'avg-latency',
            title: 'Average Latency',
            type: 'line',
            series: [],
            description: 'Average task latency over time',
          },
          {
            id: 'retry-count',
            title: 'Retry Count',
            type: 'bar',
            series: [],
            description: 'Retry attempts by task run',
          },
          {
            id: 'tool-errors',
            title: 'Tool Errors',
            type: 'bar',
            series: [],
            description: 'Tool error count over time',
          },
          {
            id: 'memory-hit-rate',
            title: 'Memory Hit Rate',
            type: 'number',
            series: [],
            description: 'Ratio of tasks with memory hits',
          },
          {
            id: 'failure-types',
            title: 'Top Failure Types',
            type: 'table',
            series: [],
            description: 'Most common failure categories',
          },
        ],
        summary: {
          totalTasks: 0,
          successRate: 0,
          avgLatencyMs: 0,
          topFailureTypes: [],
          memoryHitRate: 0,
          skillsActive: 0,
        },
      }
    }

    const period = {
      from: sortedMetrics[0].timestamp,
      to: sortedMetrics[sortedMetrics.length - 1].timestamp,
    }

    const successPoints = sortedMetrics.map((metric) => ({
      timestamp: metric.timestamp,
      value: metric.success ? 100 : 0,
      label: metric.taskId,
    }))

    const latencyPoints = sortedMetrics.map((metric) => ({
      timestamp: metric.timestamp,
      value: metric.latencyMs,
      label: metric.taskId,
    }))

    const retryPoints = sortedMetrics.map((metric) => ({
      timestamp: metric.timestamp,
      value: metric.retryCount,
      label: metric.taskId,
    }))

    const toolErrorPoints = sortedMetrics.map((metric) => ({
      timestamp: metric.timestamp,
      value: metric.toolErrors,
      label: metric.taskId,
    }))

    const memoryHitPoints = sortedMetrics.map((metric) => ({
      timestamp: metric.timestamp,
      value: metric.memoryHits.length > 0 ? 100 : 0,
      label: metric.taskId,
    }))

    const failureTypeCounts = new Map<string, number>()
    for (const metric of sortedMetrics) {
      if (!metric.success) {
        const reasons: string[] = []
        if (metric.toolErrors > 0) reasons.push('tool-errors')
        if (metric.retryCount > 0) reasons.push('retries')
        if (metric.memoryHits.length === 0) reasons.push('no-memory-hit')
        if (reasons.length === 0) reasons.push('unknown')

        for (const reason of reasons) {
          failureTypeCounts.set(reason, (failureTypeCounts.get(reason) ?? 0) + 1)
        }
      }
    }

    const topFailureEntries = [...failureTypeCounts.entries()].sort((a, b) => b[1] - a[1])
    const topFailureTypes = topFailureEntries.slice(0, 5).map(([name]) => name)
    const failureTypePoints = topFailureEntries.map(([name, count], index) => ({
      timestamp: period.from + index,
      value: count,
      label: name,
    }))

    const summary = {
      totalTasks: sortedMetrics.length,
      successRate: this.average(successPoints),
      avgLatencyMs: this.average(latencyPoints),
      topFailureTypes,
      memoryHitRate: this.average(memoryHitPoints),
      skillsActive: new Set(
        sortedMetrics.flatMap((metric) => metric.memoryHits.filter((hit) => hit.trim().length > 0)),
      ).size,
    }

    const panels: DashboardPanel[] = [
      {
        id: 'success-rate',
        title: 'Success Rate',
        type: 'line',
        series: [this.createSeries('Success Rate', '%', successPoints)],
        description: 'Task success rate over time',
      },
      {
        id: 'avg-latency',
        title: 'Average Latency',
        type: 'line',
        series: [this.createSeries('Average Latency', 'ms', latencyPoints)],
        description: 'Average task latency over time',
      },
      {
        id: 'retry-count',
        title: 'Retry Count',
        type: 'bar',
        series: [this.createSeries('Retry Count', 'count', retryPoints)],
        description: 'Retry attempts by task run',
      },
      {
        id: 'tool-errors',
        title: 'Tool Errors',
        type: 'bar',
        series: [this.createSeries('Tool Errors', 'count', toolErrorPoints)],
        description: 'Tool error count over time',
      },
      {
        id: 'memory-hit-rate',
        title: 'Memory Hit Rate',
        type: 'number',
        series: [this.createSeries('Memory Hit Rate', '%', memoryHitPoints)],
        description: 'Ratio of tasks with memory hits',
      },
      {
        id: 'failure-types',
        title: 'Top Failure Types',
        type: 'table',
        series: [this.createSeries('Failure Types', 'count', failureTypePoints)],
        description: 'Most common failure categories',
      },
    ]

    return {
      title: 'Metrics Dashboard',
      generatedAt,
      period,
      panels,
      summary,
    }
  }

  exportWeeklyReport(data: DashboardData): string {
    const periodLabel = `${this.formatDate(data.period.from)} → ${this.formatDate(data.period.to)}`
    const panelLines = data.panels.map((panel) => {
      const seriesLines = panel.series.map((series) => {
        const latest = series.points[series.points.length - 1]?.value ?? 0
        return `- ${series.name}: ${this.formatValue(latest, series.unit)} | trend=${series.trend} | change=${series.changePercent.toFixed(2)}%`
      })

      return [`### ${panel.title}`, panel.description ?? '', ...seriesLines].filter(Boolean).join('\n')
    })

    return [
      `# ${data.title} Weekly Report`,
      '',
      `- Generated At: ${this.formatDate(data.generatedAt)}`,
      `- Period: ${periodLabel}`,
      '',
      '## Summary',
      `- Total Tasks: ${data.summary.totalTasks}`,
      `- Success Rate: ${data.summary.successRate.toFixed(2)}%`,
      `- Avg Latency: ${data.summary.avgLatencyMs.toFixed(2)} ms`,
      `- Memory Hit Rate: ${data.summary.memoryHitRate.toFixed(2)}%`,
      `- Skills Active: ${data.summary.skillsActive}`,
      `- Top Failure Types: ${data.summary.topFailureTypes.join(', ') || 'none'}`,
      '',
      '## Panels',
      ...panelLines,
    ].join('\n')
  }

  private calcTrend(points: MetricPoint[]): 'up' | 'down' | 'stable' {
    if (points.length < 2) {
      return 'stable'
    }

    const first = points[0]?.value ?? 0
    const last = points[points.length - 1]?.value ?? 0

    if (last > first) {
      return 'up'
    }

    if (last < first) {
      return 'down'
    }

    return 'stable'
  }

  private createSeries(name: string, unit: string, points: MetricPoint[]): MetricSeries {
    return {
      name,
      unit,
      points,
      trend: this.calcTrend(points),
      changePercent: this.calcChangePercent(points),
    }
  }

  private calcChangePercent(points: MetricPoint[]): number {
    if (points.length < 2) {
      return 0
    }

    const midpoint = Math.floor(points.length / 2)
    const previous = this.average(points.slice(0, midpoint))
    const current = this.average(points.slice(midpoint))

    if (previous === 0) {
      return current === 0 ? 0 : 100
    }

    return ((current - previous) / previous) * 100
  }

  private average(points: MetricPoint[]): number {
    if (points.length === 0) {
      return 0
    }

    const total = points.reduce((sum, point) => sum + point.value, 0)
    return total / points.length
  }

  private formatDate(timestamp: number): string {
    return new Date(timestamp).toISOString()
  }

  private formatValue(value: number, unit: string): string {
    if (unit === '%') {
      return `${value.toFixed(2)}%`
    }

    if (unit === 'ms') {
      return `${value.toFixed(2)} ms`
    }

    return `${value.toFixed(2)} ${unit}`
  }
}
