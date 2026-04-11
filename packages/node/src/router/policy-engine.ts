export type TaskType = string

export interface Task {
  id: string
  type: TaskType
  priority: "low" | "normal" | "high"
  payload: Record<string, unknown>
}

export interface RoutingContext {
  availableAgents: string[]
  agentProfiles?: Record<string, { successRate: number; specialties: string[] }>
  memoryHits?: Record<string, string[]>
  costConstraint?: "low" | "normal" | "any"
}

export interface RoutingDecision {
  agentId: string
  reason: string
  confidence: number
  fallbackAgentId?: string
  estimatedLatencyMs?: number
}

export interface RoutingPolicy {
  name: string
  priority: number
  condition: (task: Task, ctx: RoutingContext) => boolean
  decide: (task: Task, ctx: RoutingContext) => RoutingDecision | null
}

type AgentScore = {
  agentId: string
  score: number
}

const PRIORITY_LATENCY: Record<Task["priority"], number> = {
  low: 1200,
  normal: 800,
  high: 450,
}

const LOW_COST_AGENT_HINTS = ["mini", "flash", "haiku", "cheap", "low"]
const NORMAL_COST_AGENT_HINTS = ["sonnet", "balanced", "standard", "medium", "normal"]

export class PolicyEngine {
  private policies: RoutingPolicy[] = []

  constructor() {
    this.setupDefaultPolicies()
  }

  register(policy: RoutingPolicy): void {
    this.policies.push(policy)
    this.policies.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
  }

  route(task: Task, ctx: RoutingContext): RoutingDecision {
    const availableAgents = this.normalizeAvailableAgents(ctx.availableAgents)
    if (availableAgents.length === 0) {
      throw new Error("No available agents for routing")
    }

    const normalizedCtx: RoutingContext = {
      ...ctx,
      availableAgents,
    }

    for (const policy of this.policies) {
      if (!policy.condition(task, normalizedCtx)) {
        continue
      }

      const decision = policy.decide(task, normalizedCtx)
      if (decision) {
        return this.withFallback(decision, normalizedCtx.availableAgents)
      }
    }

    return this.createDefaultDecision(task, normalizedCtx.availableAgents)
  }

  listPolicies(): RoutingPolicy[] {
    return [...this.policies]
  }

  private setupDefaultPolicies(): void {
    this.register({
      name: "memory-hit-priority",
      priority: 10,
      condition: (_task, ctx) => this.rankMemoryHits(ctx).length > 0,
      decide: (task, ctx) => {
        const ranked = this.rankMemoryHits(ctx)
        if (ranked.length === 0) {
          return null
        }

        const winner = ranked[0]
        return {
          agentId: winner.agentId,
          reason: `memory hit priority: ${winner.score} relevant memories for ${task.type}`,
          confidence: this.clamp(0.65 + winner.score * 0.08, 0, 0.96),
          estimatedLatencyMs: this.estimateLatency(task, winner.agentId),
        }
      },
    })

    this.register({
      name: "specialty-match-priority",
      priority: 20,
      condition: (task, ctx) => this.rankSpecialtyMatches(task, ctx).length > 0,
      decide: (task, ctx) => {
        const ranked = this.rankSpecialtyMatches(task, ctx)
        if (ranked.length === 0) {
          return null
        }

        const winner = ranked[0]
        return {
          agentId: winner.agentId,
          reason: `specialty match priority: ${winner.score} specialty hit(s) for ${task.type}`,
          confidence: this.clamp(0.62 + winner.score * 0.1, 0, 0.94),
          estimatedLatencyMs: this.estimateLatency(task, winner.agentId),
        }
      },
    })

    this.register({
      name: "success-rate-priority",
      priority: 30,
      condition: (_task, ctx) => this.rankSuccessRates(ctx).length > 0,
      decide: (task, ctx) => {
        const ranked = this.rankSuccessRates(ctx)
        if (ranked.length === 0) {
          return null
        }

        const winner = ranked[0]
        return {
          agentId: winner.agentId,
          reason: `success rate priority: ${Math.round(winner.score * 100)}% historical success`,
          confidence: this.clamp(0.55 + winner.score * 0.35, 0, 0.95),
          estimatedLatencyMs: this.estimateLatency(task, winner.agentId),
        }
      },
    })

    this.register({
      name: "cost-constraint-priority",
      priority: 40,
      condition: (_task, ctx) => !!ctx.costConstraint && ctx.costConstraint !== "any",
      decide: (task, ctx) => {
        const winner = this.pickByCost(ctx)
        if (!winner) {
          return null
        }

        return {
          agentId: winner,
          reason: `cost constraint priority: optimized for ${ctx.costConstraint} cost`,
          confidence: ctx.costConstraint === "low" ? 0.72 : 0.64,
          estimatedLatencyMs: this.estimateLatency(task, winner),
        }
      },
    })

    this.register({
      name: "load-balance-priority",
      priority: 50,
      condition: (_task, ctx) => ctx.availableAgents.length > 0,
      decide: (task, ctx) => {
        const winner = this.pickLeastLoaded(task, ctx)
        if (!winner) {
          return null
        }

        return {
          agentId: winner,
          reason: `load balance priority: evenly distributing ${task.priority} workload`,
          confidence: 0.58,
          estimatedLatencyMs: this.estimateLatency(task, winner),
        }
      },
    })
  }

  private normalizeAvailableAgents(agents: string[]): string[] {
    return [...new Set(agents.filter(Boolean))]
  }

  private withFallback(decision: RoutingDecision, availableAgents: string[]): RoutingDecision {
    if (decision.fallbackAgentId || availableAgents.length < 2) {
      return {
        ...decision,
        confidence: this.clamp(decision.confidence, 0, 1),
      }
    }

    const fallbackAgentId = availableAgents.find((agentId) => agentId !== decision.agentId)

    return {
      ...decision,
      confidence: this.clamp(decision.confidence, 0, 1),
      fallbackAgentId: fallbackAgentId ?? decision.fallbackAgentId,
    }
  }

  private createDefaultDecision(task: Task, availableAgents: string[]): RoutingDecision {
    const agentId = availableAgents[0]
    return this.withFallback(
      {
        agentId,
        reason: `default routing fallback for ${task.type}`,
        confidence: 0.4,
        estimatedLatencyMs: this.estimateLatency(task, agentId),
      },
      availableAgents,
    )
  }

  private rankMemoryHits(ctx: RoutingContext): AgentScore[] {
    const memoryHits = ctx.memoryHits ?? {}

    return ctx.availableAgents
      .map((agentId) => ({ agentId, score: memoryHits[agentId]?.length ?? 0 }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.agentId.localeCompare(b.agentId))
  }

  private rankSpecialtyMatches(task: Task, ctx: RoutingContext): AgentScore[] {
    const tokens = this.taskTokens(task)

    return ctx.availableAgents
      .map((agentId) => {
        const specialties = ctx.agentProfiles?.[agentId]?.specialties ?? []
        const score = specialties.reduce((count, specialty) => {
          return count + (tokens.has(this.normalizeToken(specialty)) ? 1 : 0)
        }, 0)
        return { agentId, score }
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.agentId.localeCompare(b.agentId))
  }

  private rankSuccessRates(ctx: RoutingContext): AgentScore[] {
    return ctx.availableAgents
      .map((agentId) => ({
        agentId,
        score: ctx.agentProfiles?.[agentId]?.successRate ?? -1,
      }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score || a.agentId.localeCompare(b.agentId))
  }

  private pickByCost(ctx: RoutingContext): string | null {
    const hints = ctx.costConstraint === "low" ? LOW_COST_AGENT_HINTS : NORMAL_COST_AGENT_HINTS
    const matched = ctx.availableAgents.find((agentId) => {
      const normalized = agentId.toLowerCase()
      return hints.some((hint) => normalized.includes(hint))
    })

    if (matched) {
      return matched
    }

    return [...ctx.availableAgents].sort((a, b) => a.localeCompare(b))[0] ?? null
  }

  private pickLeastLoaded(task: Task, ctx: RoutingContext): string | null {
    const ordered = [...ctx.availableAgents].sort((a, b) => {
      const aLatency = this.estimateLatency(task, a)
      const bLatency = this.estimateLatency(task, b)
      return aLatency - bLatency || a.localeCompare(b)
    })

    return ordered[0] ?? null
  }

  private estimateLatency(task: Task, agentId: string): number {
    const base = PRIORITY_LATENCY[task.priority]
    const normalized = agentId.toLowerCase()

    if (normalized.includes("flash") || normalized.includes("haiku") || normalized.includes("mini")) {
      return Math.round(base * 0.8)
    }

    if (normalized.includes("opus") || normalized.includes("max") || normalized.includes("pro")) {
      return Math.round(base * 1.35)
    }

    return base
  }

  private taskTokens(task: Task): Set<string> {
    const tokens = new Set<string>()
    for (const raw of [task.type, ...Object.keys(task.payload)]) {
      for (const part of raw.split(/[^a-zA-Z0-9]+/).filter(Boolean)) {
        tokens.add(this.normalizeToken(part))
      }
    }
    return tokens
  }

  private normalizeToken(value: string): string {
    return value.trim().toLowerCase()
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
  }
}
