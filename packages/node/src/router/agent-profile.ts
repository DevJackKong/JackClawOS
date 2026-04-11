import fs from 'fs'
import path from 'path'

export interface AgentProfile {
  agentId: string
  name: string
  specialties: string[]
  metrics: {
    totalTasks: number
    successRate: number
    avgLatencyMs: number
    failureTypes: Record<string, number>
    toolSuccessRates: Record<string, number>
  }
  lastActive: number
  version: string
}

type TaskResult = {
  taskType: string
  success: boolean
  latencyMs: number
  toolErrors?: Record<string, boolean>
}

type AgentProfileState = {
  profiles: Record<string, AgentProfile>
  taskTypeStats: Record<string, Record<string, { total: number; success: number }>>
  latencyTotals: Record<string, number>
  toolStats: Record<string, Record<string, { total: number; success: number }>>
}

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function clampRate(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function inferName(agentId: string): string {
  return agentId
}

function inferVersion(): string {
  return '1.0.0'
}

export class AgentProfileManager {
  private profiles = new Map<string, AgentProfile>()
  private taskTypeStats = new Map<string, Map<string, { total: number; success: number }>>()
  private latencyTotals = new Map<string, number>()
  private toolStats = new Map<string, Map<string, { total: number; success: number }>>()

  recordTaskResult(agentId: string, result: TaskResult): void {
    const now = Date.now()
    const profile = this.ensureProfile(agentId)
    const previousTotalTasks = profile.metrics.totalTasks
    const previousSuccesses = Math.round(profile.metrics.successRate * previousTotalTasks)
    const nextTotalTasks = previousTotalTasks + 1
    const nextSuccesses = previousSuccesses + (result.success ? 1 : 0)
    const nextLatencyTotal = (this.latencyTotals.get(agentId) ?? profile.metrics.avgLatencyMs * previousTotalTasks) + result.latencyMs

    profile.metrics.totalTasks = nextTotalTasks
    profile.metrics.successRate = clampRate(nextSuccesses / nextTotalTasks)
    profile.metrics.avgLatencyMs = nextLatencyTotal / nextTotalTasks
    profile.lastActive = now
    profile.version = profile.version || inferVersion()

    this.latencyTotals.set(agentId, nextLatencyTotal)

    if (!profile.specialties.includes(result.taskType)) {
      profile.specialties.push(result.taskType)
    }

    const taskTypeMap = this.getOrCreateNestedMap(this.taskTypeStats, agentId)
    const taskTypeStat = taskTypeMap.get(result.taskType) ?? { total: 0, success: 0 }
    taskTypeStat.total += 1
    if (result.success) taskTypeStat.success += 1
    taskTypeMap.set(result.taskType, taskTypeStat)

    if (result.toolErrors) {
      const toolMap = this.getOrCreateNestedMap(this.toolStats, agentId)
      for (const [toolName, hasError] of Object.entries(result.toolErrors)) {
        const toolStat = toolMap.get(toolName) ?? { total: 0, success: 0 }
        toolStat.total += 1
        if (!hasError) toolStat.success += 1
        toolMap.set(toolName, toolStat)
        profile.metrics.toolSuccessRates[toolName] = clampRate(toolStat.success / toolStat.total)

        if (hasError) {
          profile.metrics.failureTypes[toolName] = (profile.metrics.failureTypes[toolName] ?? 0) + 1
        }
      }
    }

    if (!result.success) {
      profile.metrics.failureTypes[result.taskType] = (profile.metrics.failureTypes[result.taskType] ?? 0) + 1
    }
  }

  getBestAgent(taskType: string): string | null {
    let bestAgentId: string | null = null
    let bestScore = Number.NEGATIVE_INFINITY

    for (const profile of this.profiles.values()) {
      const taskTypeMap = this.taskTypeStats.get(profile.agentId)
      const taskStats = taskTypeMap?.get(taskType)
      const taskSuccessRate = taskStats && taskStats.total > 0
        ? taskStats.success / taskStats.total
        : profile.metrics.successRate
      const specialtyBoost = profile.specialties.includes(taskType) ? 0.15 : 0
      const latencyPenalty = 1 / (1 + Math.max(profile.metrics.avgLatencyMs, 0))
      const confidenceBoost = Math.min(profile.metrics.totalTasks / 20, 1) * 0.05
      const score = taskSuccessRate + specialtyBoost + latencyPenalty + confidenceBoost

      if (score > bestScore) {
        bestScore = score
        bestAgentId = profile.agentId
      }
    }

    return bestAgentId
  }

  getProfile(agentId: string): AgentProfile | null {
    const profile = this.profiles.get(agentId)
    return profile ? this.cloneProfile(profile) : null
  }

  listAgents(): AgentProfile[] {
    return Array.from(this.profiles.values())
      .map(profile => this.cloneProfile(profile))
      .sort((a, b) => b.lastActive - a.lastActive)
  }

  save(filePath: string): void {
    const state: AgentProfileState = {
      profiles: Object.fromEntries(
        Array.from(this.profiles.entries()).map(([agentId, profile]) => [agentId, this.cloneProfile(profile)]),
      ),
      taskTypeStats: Object.fromEntries(
        Array.from(this.taskTypeStats.entries()).map(([agentId, stats]) => [agentId, Object.fromEntries(stats.entries())]),
      ),
      latencyTotals: Object.fromEntries(this.latencyTotals.entries()),
      toolStats: Object.fromEntries(
        Array.from(this.toolStats.entries()).map(([agentId, stats]) => [agentId, Object.fromEntries(stats.entries())]),
      ),
    }

    ensureDir(filePath)
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8')
  }

  load(filePath: string): void {
    if (!fs.existsSync(filePath)) return

    const raw = fs.readFileSync(filePath, 'utf-8')
    if (!raw.trim()) return

    const parsed = JSON.parse(raw) as Partial<AgentProfileState>

    this.profiles = new Map(
      Object.entries(parsed.profiles ?? {}).map(([agentId, profile]) => [
        agentId,
        {
          agentId,
          name: profile.name ?? inferName(agentId),
          specialties: Array.isArray(profile.specialties) ? [...profile.specialties] : [],
          metrics: {
            totalTasks: profile.metrics?.totalTasks ?? 0,
            successRate: clampRate(profile.metrics?.successRate ?? 0),
            avgLatencyMs: profile.metrics?.avgLatencyMs ?? 0,
            failureTypes: { ...(profile.metrics?.failureTypes ?? {}) },
            toolSuccessRates: { ...(profile.metrics?.toolSuccessRates ?? {}) },
          },
          lastActive: profile.lastActive ?? 0,
          version: profile.version ?? inferVersion(),
        },
      ]),
    )

    this.taskTypeStats = new Map(
      Object.entries(parsed.taskTypeStats ?? {}).map(([agentId, stats]) => [
        agentId,
        new Map(Object.entries(stats ?? {})),
      ]),
    )

    this.latencyTotals = new Map(Object.entries(parsed.latencyTotals ?? {}).map(([agentId, total]) => [agentId, Number(total) || 0]))

    this.toolStats = new Map(
      Object.entries(parsed.toolStats ?? {}).map(([agentId, stats]) => [
        agentId,
        new Map(Object.entries(stats ?? {})),
      ]),
    )

    for (const profile of this.profiles.values()) {
      if (!this.latencyTotals.has(profile.agentId)) {
        this.latencyTotals.set(profile.agentId, profile.metrics.avgLatencyMs * profile.metrics.totalTasks)
      }
    }
  }

  private ensureProfile(agentId: string): AgentProfile {
    const existing = this.profiles.get(agentId)
    if (existing) return existing

    const created: AgentProfile = {
      agentId,
      name: inferName(agentId),
      specialties: [],
      metrics: {
        totalTasks: 0,
        successRate: 0,
        avgLatencyMs: 0,
        failureTypes: {},
        toolSuccessRates: {},
      },
      lastActive: 0,
      version: inferVersion(),
    }

    this.profiles.set(agentId, created)
    return created
  }

  private getOrCreateNestedMap(
    root: Map<string, Map<string, { total: number; success: number }>>,
    agentId: string,
  ): Map<string, { total: number; success: number }> {
    const existing = root.get(agentId)
    if (existing) return existing
    const created = new Map<string, { total: number; success: number }>()
    root.set(agentId, created)
    return created
  }

  private cloneProfile(profile: AgentProfile): AgentProfile {
    return {
      agentId: profile.agentId,
      name: profile.name,
      specialties: [...profile.specialties],
      metrics: {
        totalTasks: profile.metrics.totalTasks,
        successRate: profile.metrics.successRate,
        avgLatencyMs: profile.metrics.avgLatencyMs,
        failureTypes: { ...profile.metrics.failureTypes },
        toolSuccessRates: { ...profile.metrics.toolSuccessRates },
      },
      lastActive: profile.lastActive,
      version: profile.version,
    }
  }
}
