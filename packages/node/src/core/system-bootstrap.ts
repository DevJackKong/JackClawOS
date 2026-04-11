import fs from 'node:fs'
import path from 'node:path'
import type { Server } from 'node:http'
import { MemoryManager } from '@jackclaw/memory'
import type { NodeIdentity } from '@jackclaw/protocol'
import type { JackClawConfig } from '../config'
import { loadConfig } from '../config'
import { loadOrCreateIdentity } from '../identity'
import { createNodeGateway } from '../llm-gateway'
import { MetricsCollector } from '../metrics/task-metrics'
import { SelfUpgradeSystem } from '../optimizer/self-upgrade'
import { AgentProfileManager } from '../router/agent-profile'
import { createServer } from '../server'
import { SkillLibrary } from '../skill-library'
import { getOwnerMemory, type OwnerMemory } from '../owner-memory'

export interface SystemConfig {
  dataDir: string
  port: number
  enableApi: boolean
  enableWebhooks: boolean
  enablePlugins: boolean
  enableMetrics: boolean
  upgradeSchedule: {
    enabled: boolean
    intervalMs: number
  }
  agentPool: {
    minIdle: number
    maxSize: number
  }
}

type SubsystemState = 'ok' | 'error' | 'disabled'

const DEFAULT_CONFIG: SystemConfig = {
  dataDir: path.join(process.cwd(), '.jackclaw-system'),
  port: 19000,
  enableApi: true,
  enableWebhooks: true,
  enablePlugins: true,
  enableMetrics: true,
  upgradeSchedule: {
    enabled: false,
    intervalMs: 30 * 60 * 1000,
  },
  agentPool: {
    minIdle: 1,
    maxSize: 4,
  },
}

class FourLayerMemory {
  constructor(
    readonly manager: MemoryManager,
    readonly ownerMemory: OwnerMemory,
  ) {}

  getLayers(): string[] {
    return ['working', 'episodic', 'semantic', 'owner']
  }
}

class SkillTracker {
  private readonly usage = new Map<string, number>()

  record(skillId: string): void {
    this.usage.set(skillId, (this.usage.get(skillId) ?? 0) + 1)
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.usage.entries())
  }
}

class SmartRouter {
  constructor(private readonly profiles: AgentProfileManager) {}

  route(taskType: string): string | null {
    return this.profiles.getBestAgent(taskType)
  }
}

class AgentPool {
  private workers: Array<{ id: string; warm: boolean; busy: boolean }> = []

  constructor(private readonly config: SystemConfig['agentPool']) {}

  async warmup(): Promise<void> {
    const target = Math.max(0, Math.min(this.config.minIdle, this.config.maxSize))
    for (let index = 0; index < target; index += 1) {
      this.workers.push({
        id: `agent-${index + 1}`,
        warm: true,
        busy: false,
      })
    }
  }

  shutdown(): void {
    this.workers = []
  }

  size(): number {
    return this.workers.length
  }
}

class PriorityQueue {
  private readonly queue: Array<{ priority: number; task: string }> = []

  enqueue(task: string, priority = 0): void {
    this.queue.push({ priority, task })
    this.queue.sort((a, b) => b.priority - a.priority)
  }

  size(): number {
    return this.queue.length
  }
}

class TaskCompletionHook {
  run(taskId: string): void {
    void taskId
  }
}

class TaskStartHook {
  run(taskId: string): void {
    void taskId
  }
}

class UpgradeScheduler {
  private timer?: NodeJS.Timeout

  constructor(
    private readonly system: SelfUpgradeSystem,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.system.runCycle({ taskLogs: [], memoryHits: [] }).catch(() => {})
    }, this.intervalMs)
    this.timer.unref()
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = undefined
  }
}

class AlertManager {
  private lastAlert: string | null = null

  notify(message: string): void {
    this.lastAlert = message
  }

  getLastAlert(): string | null {
    return this.lastAlert
  }
}

class RealtimeMetrics {
  constructor(private readonly collector: MetricsCollector) {}

  getSnapshot(): ReturnType<MetricsCollector['getStats']> {
    return this.collector.getStats()
  }
}

export class SystemBootstrap {
  private readonly config: SystemConfig
  private readonly status: Record<string, SubsystemState> = {
    memory: 'disabled',
    skills: 'disabled',
    router: 'disabled',
    agentPool: 'disabled',
    priorityQueue: 'disabled',
    hooks: 'disabled',
    upgradeScheduler: 'disabled',
    alerts: 'disabled',
    metrics: 'disabled',
    api: 'disabled',
  }

  private initialized = false
  private startedAt = 0

  private identity?: NodeIdentity
  private nodeConfig?: JackClawConfig
  private memoryManager?: MemoryManager
  private ownerMemory?: OwnerMemory
  private fourLayerMemory?: FourLayerMemory
  private skillRegistry?: SkillLibrary
  private skillTracker?: SkillTracker
  private agentProfiles?: AgentProfileManager
  private smartRouter?: SmartRouter
  private agentPool?: AgentPool
  private priorityQueue?: PriorityQueue
  private taskCompletionHook?: TaskCompletionHook
  private taskStartHook?: TaskStartHook
  private selfUpgrade?: SelfUpgradeSystem
  private upgradeScheduler?: UpgradeScheduler
  private alertManager?: AlertManager
  private metricsCollector?: MetricsCollector
  private realtimeMetrics?: RealtimeMetrics
  private apiServer?: Server

  constructor(config: Partial<SystemConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      upgradeSchedule: {
        ...DEFAULT_CONFIG.upgradeSchedule,
        ...(config.upgradeSchedule ?? {}),
      },
      agentPool: {
        ...DEFAULT_CONFIG.agentPool,
        ...(config.agentPool ?? {}),
      },
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return

    fs.mkdirSync(this.config.dataDir, { recursive: true })
    this.startedAt = Date.now()

    try {
      // 1. 记忆系统（MemoryManager + 四层记忆）
      this.memoryManager = new MemoryManager()
      this.identity = loadOrCreateIdentity()
      this.ownerMemory = getOwnerMemory(this.identity.nodeId)
      this.fourLayerMemory = new FourLayerMemory(this.memoryManager, this.ownerMemory)
      this.status.memory = 'ok'

      // 2. Skill Registry + SkillTracker
      this.skillRegistry = new SkillLibrary(this.identity.nodeId)
      this.skillTracker = new SkillTracker()
      this.status.skills = 'ok'

      // 3. AgentProfileManager + SmartRouter
      this.agentProfiles = new AgentProfileManager()
      this.smartRouter = new SmartRouter(this.agentProfiles)
      this.nodeConfig = this.buildNodeConfig()
      createNodeGateway(this.nodeConfig)
      this.status.router = 'ok'

      // 4. AgentPool 预热
      this.agentPool = new AgentPool(this.config.agentPool)
      await this.agentPool.warmup()
      this.status.agentPool = 'ok'

      // 5. PriorityQueue
      this.priorityQueue = new PriorityQueue()
      this.status.priorityQueue = 'ok'

      // 6. TaskCompletionHook + TaskStartHook
      this.taskCompletionHook = new TaskCompletionHook()
      this.taskStartHook = new TaskStartHook()
      this.status.hooks = 'ok'

      // 7. UpgradeScheduler（如启用）
      if (this.config.upgradeSchedule.enabled) {
        this.selfUpgrade = new SelfUpgradeSystem({
          scanIntervalMs: this.config.upgradeSchedule.intervalMs,
          reportOutputPath: path.join(this.config.dataDir, 'self-upgrade-report.md'),
        })
        this.upgradeScheduler = new UpgradeScheduler(this.selfUpgrade, this.config.upgradeSchedule.intervalMs)
        this.upgradeScheduler.start()
        this.status.upgradeScheduler = 'ok'
      } else {
        this.status.upgradeScheduler = 'disabled'
      }

      // 8. AlertManager
      this.alertManager = new AlertManager()
      this.status.alerts = 'ok'

      // 9. RealtimeMetrics
      if (this.config.enableMetrics) {
        this.metricsCollector = new MetricsCollector()
        this.realtimeMetrics = new RealtimeMetrics(this.metricsCollector)
        this.status.metrics = 'ok'
      } else {
        this.status.metrics = 'disabled'
      }

      // 10. API Server（如启用）
      if (this.config.enableApi) {
        const app = createServer(this.identity, this.nodeConfig)
        await new Promise<void>((resolve, reject) => {
          const server = app.listen(this.config.port, () => resolve())
          server.once('error', reject)
          this.apiServer = server
        })
        this.status.api = 'ok'
      } else {
        this.status.api = 'disabled'
      }

      this.initialized = true
    } catch (error) {
      this.markUnknownSubsystemsAsError()
      throw error
    }
  }

  async shutdown(): Promise<void> {
    this.upgradeScheduler?.stop()

    if (this.apiServer) {
      await new Promise<void>((resolve, reject) => {
        this.apiServer?.close((error?: Error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
      this.apiServer = undefined
    }

    this.ownerMemory?.flush()
    this.agentPool?.shutdown()
    this.initialized = false
  }

  getStatus(): {
    initialized: boolean
    uptime: number
    subsystems: Record<string, 'ok' | 'error' | 'disabled'>
  } {
    return {
      initialized: this.initialized,
      uptime: this.startedAt > 0 ? Date.now() - this.startedAt : 0,
      subsystems: { ...this.status },
    }
  }

  private buildNodeConfig(): JackClawConfig {
    const base = loadConfig()
    return {
      ...base,
      port: this.config.port,
      workspaceDir: this.config.dataDir,
      visibility: {
        ...base.visibility,
        shareTasks: true,
        shareMemory: true,
      },
    }
  }

  private markUnknownSubsystemsAsError(): void {
    for (const key of Object.keys(this.status)) {
      if (this.status[key] === 'disabled') {
        this.status[key] = 'error'
      }
    }
  }
}
