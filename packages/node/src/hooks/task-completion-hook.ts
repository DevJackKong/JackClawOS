import { TaskReflectionExtractor, writeReflection } from '@jackclaw/memory'
import { OptimizerAgent, type OptimizationTarget } from '../optimizer/optimizer-agent'
import { AgentProfileManager } from '../router/agent-profile'
import { MetricsCollector } from '../metrics/task-metrics'

export interface CompletedTaskResult {
  taskId: string
  taskType: string
  agentId: string
  success: boolean
  log: string
  latencyMs: number
  retryCount: number
}

export interface TaskCompletionHookOptions {
  reflectionExtractor?: TaskReflectionExtractor
  reflectionWriteback?: ReflectionWriteback
  agentProfileManager?: AgentProfileManager
  metricsCollector?: MetricsCollector
  optimizerAgent?: OptimizerAgent
}

export class ReflectionWriteback {
  constructor(private readonly memoryDir = process.env.JACKCLAW_REFLECTION_DIR ?? 'data/reflections') {}

  write(reflection: {
    task: string
    result: string
    cause: string
    fix: string
    reusable_rule: string
    confidence: number
  }): void {
    writeReflection(reflection, this.memoryDir)
  }
}

// 任务完成后自动触发的钩子
export class TaskCompletionHook {
  private readonly reflectionExtractor: TaskReflectionExtractor
  private readonly reflectionWriteback: ReflectionWriteback
  private readonly agentProfileManager: AgentProfileManager
  private readonly metricsCollector: MetricsCollector
  private readonly optimizerAgent: OptimizerAgent
  private readonly taskLogHistory: Array<{
    taskType: string
    success: boolean
    retryCount: number
    latencyMs: number
  }> = []
  private readonly optimizerReports = new Map<string, OptimizationTarget[]>()

  constructor(options: TaskCompletionHookOptions = {}) {
    this.reflectionExtractor = options.reflectionExtractor ?? new TaskReflectionExtractor()
    this.reflectionWriteback = options.reflectionWriteback ?? new ReflectionWriteback()
    this.agentProfileManager = options.agentProfileManager ?? new AgentProfileManager()
    this.metricsCollector = options.metricsCollector ?? new MetricsCollector()
    this.optimizerAgent = options.optimizerAgent ?? new OptimizerAgent()
  }

  // 注册到任务执行器，任务完成后自动调用
  async onTaskComplete(taskResult: CompletedTaskResult): Promise<void> {
    const now = Date.now()
    const endedAt = now
    const startedAt = Math.max(0, endedAt - Math.max(0, taskResult.latencyMs))

    // 1. 调用 TaskReflectionExtractor 提取反思
    const reflection = this.reflectionExtractor.extract(taskResult.log, {
      taskId: taskResult.taskId,
      taskType: taskResult.taskType,
      agentId: taskResult.agentId,
      startedAt,
      endedAt,
    })

    // 2. 调用 ReflectionWriteback 写入记忆
    this.reflectionWriteback.write({
      task: reflection.taskType,
      result: reflection.result,
      cause: reflection.cause ?? '',
      fix: reflection.fix ?? '',
      reusable_rule: reflection.reusableRule ?? '',
      confidence: reflection.confidence,
    })

    // 3. 调用 AgentProfileManager.recordTaskResult 更新 profile
    this.agentProfileManager.recordTaskResult(taskResult.agentId, {
      taskType: taskResult.taskType,
      success: taskResult.success,
      latencyMs: taskResult.latencyMs,
    })

    // 4. 调用 MetricsCollector.record 记录指标
    this.metricsCollector.record({
      task_id: taskResult.taskId,
      success: taskResult.success,
      user_satisfied: taskResult.success,
      tool_errors: this.countToolErrors(taskResult.log),
      retry_count: taskResult.retryCount,
      latency_sec: this.msToSeconds(taskResult.latencyMs),
      memory_hit: reflection.shouldMemorize ? [reflection.memoryType] : [],
    })

    this.taskLogHistory.push({
      taskType: taskResult.taskType,
      success: taskResult.success,
      retryCount: taskResult.retryCount,
      latencyMs: taskResult.latencyMs,
    })

    // 5. 如果 retryCount > 2，触发 OptimizerAgent 扫描
    if (taskResult.retryCount > 2) {
      const targets = this.optimizerAgent.scanTaskLogs(this.taskLogHistory)
      this.optimizerReports.set(taskResult.taskId, targets)
    }
  }

  getMetricsCollector(): MetricsCollector {
    return this.metricsCollector
  }

  getAgentProfileManager(): AgentProfileManager {
    return this.agentProfileManager
  }

  getOptimizerAgent(): OptimizerAgent {
    return this.optimizerAgent
  }

  getOptimizationTargets(taskId: string): OptimizationTarget[] {
    return [...(this.optimizerReports.get(taskId) ?? [])]
  }

  private countToolErrors(log: string): number {
    const matches = log.match(/\b(error|failed|failure|exception|timeout|denied|rejected|报错|失败|异常|超时|拒绝)\b/giu)
    return matches?.length ?? 0
  }

  private msToSeconds(latencyMs: number): number {
    return Math.max(0, latencyMs) / 1000
  }
}
