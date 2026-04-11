export interface SystemSnapshot {
  timestamp: number
  tasks: {
    total: number
    running: number
    queued: number
    successRate: number
    avgLatencyMs: number
  }
  agents: {
    total: number
    healthy: number
    degraded: number
    unhealthy: number
    topPerformer: string | null
  }
  memory: {
    totalEntries: number
    staleEntries: number
    hitRate: number
    lastCompactionAt?: number
  }
  skills: {
    registered: number
    active: number
    evolutionCandidates: number
  }
  optimizer: {
    pendingPatches: number
    lastReportAt?: number
    lastCycleAt?: number
  }
}

type TaskSnapshotInput = {
  total?: number
  running?: number
  queued?: number
  successRate?: number
  avgLatencyMs?: number
  total_tasks?: number
  success_rate?: number
  avg_latency?: number
}

type AgentSnapshotInput = {
  total?: number
  healthy?: number
  degraded?: number
  unhealthy?: number
  topPerformer?: string | null
}

type MemorySnapshotInput = {
  totalEntries?: number
  staleEntries?: number
  hitRate?: number
  lastCompactionAt?: number
}

type SkillSnapshotInput = {
  registered?: number
  active?: number
  evolutionCandidates?: number
  total?: number
}

type OptimizerSnapshotInput = {
  pendingPatches?: number
  lastReportAt?: number
  lastCycleAt?: number
}

export interface RealtimeMetricsSources {
  tasks?: {
    getStats?: () => TaskSnapshotInput
    getHistory?: (limit?: number) => Array<{ status?: string }>
    getQueueSize?: () => number
    getRunningCount?: () => number
  }
  agents?: {
    listAgents?: () => Array<{
      agentId?: string
      name?: string
      lastActive?: number
      metrics?: {
        successRate?: number
      }
    }>
    getBestAgent?: (taskType: string) => string | null
  }
  memory?: {
    getEntries?: () => Array<{
      expiresAt?: number
      updatedAt?: number
      lastUsed?: number
      hitCount?: number
      successRate?: number
    }>
    getStats?: () => Partial<MemorySnapshotInput>
  }
  skills?: {
    getAll?: () => Array<{
      usageCount?: number
      successRate?: number
    }>
    getStats?: () => SkillSnapshotInput & { totalUsage?: number }
  }
  optimizer?: {
    getPendingPatches?: () => number
    getLastReportAt?: () => number | undefined
    getLastCycleAt?: () => number | undefined
    getReport?: () => { generatedAt?: number; targets?: unknown[] }
  }
  clock?: () => number
}

const MAX_HISTORY = 100
const STALE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const HEALTHY_WINDOW_MS = 15 * 60 * 1000
const DEGRADED_WINDOW_MS = 60 * 60 * 1000

export class RealtimeMetrics {
  private readonly history: SystemSnapshot[] = []

  constructor(private readonly sources: RealtimeMetricsSources = {}) {}

  snapshot(): SystemSnapshot {
    const timestamp = this.now()
    const taskStats = this.sources.tasks?.getStats?.() ?? {}
    const taskHistory = this.sources.tasks?.getHistory?.(MAX_HISTORY) ?? []
    const agents = this.sources.agents?.listAgents?.() ?? []
    const memoryEntries = this.sources.memory?.getEntries?.() ?? []
    const memoryStats = this.sources.memory?.getStats?.() ?? {}
    const skillStats = this.sources.skills?.getStats?.() ?? {}
    const skills = this.sources.skills?.getAll?.() ?? []
    const optimizerReport = this.sources.optimizer?.getReport?.()

    const taskTotal = this.toNumber(taskStats.total, taskStats.total_tasks)
    const taskRunning = this.toNumber(this.sources.tasks?.getRunningCount?.())
    const taskQueued = this.toNumber(this.sources.tasks?.getQueueSize?.())
    const taskSuccessRate = this.clampRate(this.toNumber(taskStats.successRate, taskStats.success_rate))
    const taskAvgLatencyMs = this.normalizeLatency(taskStats)

    const healthyAgents = agents.filter(agent => this.getAgentHealth(agent.lastActive, timestamp) === 'healthy').length
    const degradedAgents = agents.filter(agent => this.getAgentHealth(agent.lastActive, timestamp) === 'degraded').length
    const unhealthyAgents = Math.max(0, agents.length - healthyAgents - degradedAgents)

    const topPerformer = this.resolveTopPerformer(agents)
    const staleEntries = memoryStats.staleEntries ?? memoryEntries.filter(entry => this.isStaleEntry(entry, timestamp)).length
    const memoryHitRate = this.resolveMemoryHitRate(memoryEntries, memoryStats.hitRate)

    const registeredSkills = this.toNumber(skillStats.registered, skillStats.total, skills.length)
    const activeSkills = skillStats.active ?? skills.filter(skill => (skill.usageCount ?? 0) > 0).length
    const evolutionCandidates = skillStats.evolutionCandidates ?? skills.filter(skill => (skill.usageCount ?? 0) >= 3).length

    const pendingPatches = this.toNumber(
      this.sources.optimizer?.getPendingPatches?.(),
      optimizerReport?.targets?.length,
      0,
    )

    const snapshot: SystemSnapshot = {
      timestamp,
      tasks: {
        total: taskTotal,
        running: taskRunning,
        queued: taskQueued,
        successRate: taskSuccessRate,
        avgLatencyMs: taskAvgLatencyMs,
      },
      agents: {
        total: agents.length,
        healthy: healthyAgents,
        degraded: degradedAgents,
        unhealthy: unhealthyAgents,
        topPerformer,
      },
      memory: {
        totalEntries: memoryStats.totalEntries ?? memoryEntries.length,
        staleEntries,
        hitRate: this.clampRate(memoryHitRate),
        lastCompactionAt: memoryStats.lastCompactionAt,
      },
      skills: {
        registered: registeredSkills,
        active: activeSkills,
        evolutionCandidates,
      },
      optimizer: {
        pendingPatches,
        lastReportAt: this.sources.optimizer?.getLastReportAt?.() ?? optimizerReport?.generatedAt,
        lastCycleAt: this.sources.optimizer?.getLastCycleAt?.(),
      },
    }

    if (taskHistory.length > 0) {
      snapshot.tasks.running = snapshot.tasks.running || taskHistory.filter(item => item.status === 'running').length
      snapshot.tasks.queued = snapshot.tasks.queued || taskHistory.filter(item => item.status === 'queued').length
    }

    return snapshot
  }

  record(snapshot: SystemSnapshot): void {
    this.history.unshift(this.cloneSnapshot(snapshot))
    if (this.history.length > MAX_HISTORY) {
      this.history.length = MAX_HISTORY
    }
  }

  getHistory(limit = MAX_HISTORY): SystemSnapshot[] {
    const normalizedLimit = Math.max(0, Math.min(MAX_HISTORY, Math.floor(limit)))
    return this.history.slice(0, normalizedLimit).map(snapshot => this.cloneSnapshot(snapshot))
  }

  getTrend(): {
    taskSuccessRateDelta: number
    avgLatencyDelta: number
    healthyAgentsDelta: number
  } {
    const latest = this.history[0]
    const previous = this.history[1]

    if (!latest || !previous) {
      return {
        taskSuccessRateDelta: 0,
        avgLatencyDelta: 0,
        healthyAgentsDelta: 0,
      }
    }

    return {
      taskSuccessRateDelta: latest.tasks.successRate - previous.tasks.successRate,
      avgLatencyDelta: latest.tasks.avgLatencyMs - previous.tasks.avgLatencyMs,
      healthyAgentsDelta: latest.agents.healthy - previous.agents.healthy,
    }
  }

  export(): string {
    return JSON.stringify(
      {
        current: this.history[0] ?? null,
        history: this.getHistory(),
        trend: this.getTrend(),
      },
      null,
      2,
    )
  }

  private now(): number {
    return this.sources.clock?.() ?? Date.now()
  }

  private normalizeLatency(taskStats: TaskSnapshotInput): number {
    const latencyMs = this.toNumber(taskStats.avgLatencyMs)
    if (latencyMs > 0) return latencyMs

    const latencySec = this.toNumber(taskStats.avg_latency)
    return latencySec > 0 ? latencySec * 1000 : 0
  }

  private resolveTopPerformer(
    agents: Array<{
      agentId?: string
      name?: string
      metrics?: { successRate?: number }
    }>,
  ): string | null {
    if (agents.length === 0) return null

    const best = [...agents].sort((a, b) => {
      const successDelta = (b.metrics?.successRate ?? 0) - (a.metrics?.successRate ?? 0)
      if (successDelta !== 0) return successDelta
      return (b.name ?? b.agentId ?? '').localeCompare(a.name ?? a.agentId ?? '')
    })[0]

    return best?.name ?? best?.agentId ?? null
  }

  private resolveMemoryHitRate(
    entries: Array<{ hitCount?: number; successRate?: number }>,
    fallback?: number,
  ): number {
    if (typeof fallback === 'number') {
      return fallback
    }

    if (entries.length === 0) {
      return 0
    }

    const totalHits = entries.reduce((sum, entry) => sum + Math.max(0, entry.hitCount ?? 0), 0)
    if (totalHits <= 0) {
      return entries.filter(entry => (entry.successRate ?? 0) > 0).length / entries.length
    }

    const weightedSuccess = entries.reduce(
      (sum, entry) => sum + Math.max(0, entry.hitCount ?? 0) * this.clampRate(entry.successRate ?? 0),
      0,
    )

    return weightedSuccess / totalHits
  }

  private isStaleEntry(
    entry: { expiresAt?: number; updatedAt?: number; lastUsed?: number },
    now: number,
  ): boolean {
    if (typeof entry.expiresAt === 'number' && entry.expiresAt <= now) {
      return true
    }

    const touchedAt = entry.lastUsed ?? entry.updatedAt
    if (typeof touchedAt !== 'number') {
      return false
    }

    return now - touchedAt >= STALE_WINDOW_MS
  }

  private getAgentHealth(lastActive: number | undefined, now: number): 'healthy' | 'degraded' | 'unhealthy' {
    if (typeof lastActive !== 'number' || lastActive <= 0) {
      return 'unhealthy'
    }

    const idleMs = Math.max(0, now - lastActive)
    if (idleMs <= HEALTHY_WINDOW_MS) return 'healthy'
    if (idleMs <= DEGRADED_WINDOW_MS) return 'degraded'
    return 'unhealthy'
  }

  private toNumber(...values: Array<number | undefined>): number {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value
      }
    }
    return 0
  }

  private clampRate(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 0
    if (value >= 1) return 1
    return value
  }

  private cloneSnapshot(snapshot: SystemSnapshot): SystemSnapshot {
    return JSON.parse(JSON.stringify(snapshot)) as SystemSnapshot
  }
}
