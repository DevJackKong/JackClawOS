import { randomUUID } from 'crypto'

export type AgentState = 'idle' | 'busy' | 'warming' | 'offline'

export interface PooledAgent {
  instanceId: string
  agentId: string
  state: AgentState
  currentTaskId?: string
  warmedAt: number
  lastUsedAt?: number
  totalTasksHandled: number
}

export interface PoolConfig {
  minIdle: number
  maxSize: number
  warmupTimeoutMs: number
  idleTimeoutMs: number
}

interface PendingAcquire {
  agentId: string
  taskId: string
  resolve: (agent: PooledAgent) => void
  reject: (error: Error) => void
}

const DEFAULT_CONFIG: PoolConfig = {
  minIdle: 2,
  maxSize: 10,
  warmupTimeoutMs: 5000,
  idleTimeoutMs: 300000,
}

export class AgentPool {
  private readonly config: PoolConfig
  private readonly agents = new Map<string, PooledAgent>()
  private readonly pending = new Map<string, Promise<PooledAgent>>()
  private readonly waiters: PendingAcquire[] = []
  private shutdownFlag = false

  constructor(config?: Partial<PoolConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  async warmup(agentIds: string[]): Promise<void> {
    this.ensureActive()

    const uniqueAgentIds = [...new Set(agentIds.filter(Boolean))]
    const tasks: Promise<void>[] = []

    for (const agentId of uniqueAgentIds) {
      const idleCount = this.countBy(agentId, 'idle')
      const warmingCount = this.countBy(agentId, 'warming')
      const needed = Math.max(0, this.config.minIdle - idleCount - warmingCount)

      for (let i = 0; i < needed; i++) {
        if (this.agents.size + this.pending.size >= this.config.maxSize) break
        tasks.push(this.createAgent(agentId).then(() => undefined))
      }
    }

    await Promise.all(tasks)
  }

  async acquire(agentId: string, taskId: string): Promise<PooledAgent> {
    this.ensureActive()

    this.cleanup()

    const idleAgent = this.findIdleAgent(agentId)
    if (idleAgent) {
      return this.markBusy(idleAgent, taskId)
    }

    const canCreateNow = this.agents.size + this.pending.size < this.config.maxSize
    if (canCreateNow) {
      const created = await this.createAgent(agentId)
      return this.markBusy(created, taskId)
    }

    return new Promise<PooledAgent>((resolve, reject) => {
      this.waiters.push({ agentId, taskId, resolve, reject })
    })
  }

  release(instanceId: string): void {
    const agent = this.agents.get(instanceId)
    if (!agent || this.shutdownFlag) return

    agent.state = 'idle'
    agent.currentTaskId = undefined
    agent.lastUsedAt = Date.now()

    this.drainWaiters()
  }

  getStatus(): {
    total: number
    idle: number
    busy: number
    warming: number
    utilization: number
  } {
    let idle = 0
    let busy = 0
    let warming = 0

    for (const agent of this.agents.values()) {
      if (agent.state === 'idle') idle++
      else if (agent.state === 'busy') busy++
      else if (agent.state === 'warming') warming++
    }

    const total = this.agents.size

    return {
      total,
      idle,
      busy,
      warming,
      utilization: total === 0 ? 0 : busy / total,
    }
  }

  cleanup(): void {
    if (this.shutdownFlag) return

    const now = Date.now()
    const removable: string[] = []

    for (const [instanceId, agent] of this.agents.entries()) {
      if (agent.state !== 'idle') continue

      const lastActiveAt = agent.lastUsedAt ?? agent.warmedAt
      const idleFor = now - lastActiveAt
      const idleCountForType = this.countBy(agent.agentId, 'idle')

      if (idleFor > this.config.idleTimeoutMs && idleCountForType > this.config.minIdle) {
        removable.push(instanceId)
      }
    }

    for (const instanceId of removable) {
      const agent = this.agents.get(instanceId)
      if (!agent) continue
      agent.state = 'offline'
      this.agents.delete(instanceId)
    }
  }

  shutdown(): void {
    if (this.shutdownFlag) return
    this.shutdownFlag = true

    for (const agent of this.agents.values()) {
      agent.state = 'offline'
      agent.currentTaskId = undefined
    }

    this.agents.clear()
    this.pending.clear()

    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()
      waiter?.reject(new Error('AgentPool is shutdown'))
    }
  }

  private async createAgent(agentId: string): Promise<PooledAgent> {
    this.ensureActive()

    const pendingKey = `${agentId}:${randomUUID()}`
    const promise = (async () => {
      const now = Date.now()
      const instanceId = randomUUID()
      const agent: PooledAgent = {
        instanceId,
        agentId,
        state: 'warming',
        warmedAt: now,
        totalTasksHandled: 0,
      }

      this.agents.set(instanceId, agent)

      try {
        await this.simulateWarmup()
        agent.state = 'idle'
        agent.warmedAt = Date.now()
        this.drainWaiters()
        return agent
      } catch (error) {
        agent.state = 'offline'
        this.agents.delete(instanceId)
        throw error
      }
    })()

    this.pending.set(pendingKey, promise)

    try {
      return await promise
    } finally {
      this.pending.delete(pendingKey)
    }
  }

  private async simulateWarmup(): Promise<void> {
    await Promise.race([
      Promise.resolve(),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          clearTimeout(timer)
          reject(new Error('Agent warmup timeout'))
        }, this.config.warmupTimeoutMs)
      }),
    ])
  }

  private findIdleAgent(agentId: string): PooledAgent | undefined {
    let candidate: PooledAgent | undefined

    for (const agent of this.agents.values()) {
      if (agent.agentId !== agentId || agent.state !== 'idle') continue
      if (!candidate) {
        candidate = agent
        continue
      }

      const candidateLast = candidate.lastUsedAt ?? candidate.warmedAt
      const agentLast = agent.lastUsedAt ?? agent.warmedAt
      if (agentLast < candidateLast) candidate = agent
    }

    return candidate
  }

  private markBusy(agent: PooledAgent, taskId: string): PooledAgent {
    agent.state = 'busy'
    agent.currentTaskId = taskId
    agent.lastUsedAt = Date.now()
    agent.totalTasksHandled += 1
    return { ...agent }
  }

  private drainWaiters(): void {
    if (this.shutdownFlag || this.waiters.length === 0) return

    for (let i = 0; i < this.waiters.length; ) {
      const waiter = this.waiters[i]
      const idleAgent = this.findIdleAgent(waiter.agentId)

      if (!idleAgent) {
        i++
        continue
      }

      this.waiters.splice(i, 1)
      waiter.resolve(this.markBusy(idleAgent, waiter.taskId))
    }
  }

  private countBy(agentId: string, state: AgentState): number {
    let count = 0
    for (const agent of this.agents.values()) {
      if (agent.agentId === agentId && agent.state === state) count++
    }
    return count
  }

  private ensureActive(): void {
    if (this.shutdownFlag) {
      throw new Error('AgentPool is shutdown')
    }
  }
}
