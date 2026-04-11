import { AgentProfileManager, type AgentProfile } from './agent-profile'

export type SmartRouteTask = {
  id?: string
  type?: string
  priority?: 'low' | 'normal' | 'high'
  payload?: Record<string, unknown>
}

export type SmartRouteResult = {
  agentId: string
  reason: string
  confidence: number
  fallbackAgentId?: string
}

type RankedAgent = {
  agentId: string
  score: number
  successRate: number
  avgLatencyMs: number
  specialtyMatched: boolean
  confidence: number
}

function clamp(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function normalizeTaskType(task: SmartRouteTask | string): string {
  if (typeof task === 'string') return task.trim().toLowerCase()
  return (task.type ?? '').trim().toLowerCase()
}

function normalizeLatency(latencyMs: number): number {
  if (!Number.isFinite(latencyMs) || latencyMs <= 0) return 1000
  return latencyMs
}

function confidenceFromProfile(profile: AgentProfile): number {
  return clamp(profile.metrics.totalTasks / 20, 0.15, 1)
}

export class SmartRouter {
  constructor(private readonly profileManager: AgentProfileManager) {}

  route(task: SmartRouteTask | string, availableAgents: string[]): SmartRouteResult {
    const normalizedAgents = [...new Set(availableAgents.filter(Boolean))]
    if (normalizedAgents.length === 0) {
      throw new Error('No available agents for smart routing')
    }

    const taskType = normalizeTaskType(task)
    const rankedAgents = normalizedAgents
      .map((agentId) => this.rankAgent(agentId, taskType))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        if (b.successRate !== a.successRate) return b.successRate - a.successRate
        if (a.avgLatencyMs !== b.avgLatencyMs) return a.avgLatencyMs - b.avgLatencyMs
        return a.agentId.localeCompare(b.agentId)
      })

    const primary = rankedAgents[0]
    const fallback = rankedAgents.find((candidate) => candidate.agentId !== primary.agentId)

    return {
      agentId: primary.agentId,
      reason: this.buildReason(primary, taskType),
      confidence: primary.confidence,
      fallbackAgentId: fallback?.agentId,
    }
  }

  private rankAgent(agentId: string, taskType: string): RankedAgent {
    const profile = this.profileManager.getProfile(agentId)
    if (!profile) {
      return {
        agentId,
        score: 0.35,
        successRate: 0.5,
        avgLatencyMs: 1000,
        specialtyMatched: false,
        confidence: 0.25,
      }
    }

    const successRate = clamp(profile.metrics.successRate)
    const avgLatencyMs = normalizeLatency(profile.metrics.avgLatencyMs)
    const specialtyMatched = taskType.length > 0 && profile.specialties.some((specialty) => specialty.toLowerCase() === taskType)
    const latencyScore = 1 / (1 + avgLatencyMs / 1000)
    const experienceScore = confidenceFromProfile(profile)
    const specialtyBoost = specialtyMatched ? 0.08 : 0
    const score = successRate * 0.65 + latencyScore * 0.25 + experienceScore * 0.1 + specialtyBoost
    const confidence = clamp(score * 0.85 + experienceScore * 0.15)

    return {
      agentId,
      score,
      successRate,
      avgLatencyMs,
      specialtyMatched,
      confidence,
    }
  }

  private buildReason(agent: RankedAgent, taskType: string): string {
    const parts = [
      `success ${(agent.successRate * 100).toFixed(0)}%`,
      `latency ${Math.round(agent.avgLatencyMs)}ms`,
    ]

    if (taskType && agent.specialtyMatched) {
      parts.push(`matched specialty ${taskType}`)
    }

    return `selected ${agent.agentId}: ${parts.join(', ')}`
  }
}
