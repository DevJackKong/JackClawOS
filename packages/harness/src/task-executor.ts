/**
 * TaskExecutor — Three execution modes for JackClaw agents
 *
 * Modes:
 *   1. direct    — Single harness, run once
 *   2. pipeline  — Chain of tasks, output feeds next input
 *   3. parallel  — Multiple tasks concurrently, collect results
 *
 * All modes integrate with HarnessSession (audit, memory, retry, chat).
 */

import { randomUUID } from 'crypto'
import type { HarnessAdapter, HarnessTask, HarnessOutput } from './adapter'
import type { HarnessContext } from './context'
import { JackClawSession } from './session'

// ─── Types ───────────────────────────────────────────────────────────────────

export type ExecutionMode = 'direct' | 'pipeline' | 'parallel'

export interface TaskStep {
  task: HarnessTask
  adapter?: string       // override default adapter for this step
  transformInput?: (prevOutput: string) => string
}

export interface PipelineConfig {
  steps: TaskStep[]
  stopOnFailure?: boolean   // default: true
}

export interface ParallelConfig {
  tasks: TaskStep[]
  maxConcurrency?: number   // default: 3
  collectMode?: 'all' | 'first-success'  // default: 'all'
}

export interface ExecutionResult {
  id: string
  mode: ExecutionMode
  startedAt: number
  durationMs: number
  steps: StepResult[]
  status: 'success' | 'partial' | 'failed'
}

export interface StepResult {
  taskId: string
  title: string
  status: 'success' | 'failed' | 'skipped'
  output?: HarnessOutput
  error?: string
}

// ─── TaskExecutor ────────────────────────────────────────────────────────────

export class TaskExecutor {
  private adapters: Map<string, HarnessAdapter>
  private defaultAdapter: HarnessAdapter
  private context: HarnessContext

  constructor(
    adapters: Map<string, HarnessAdapter>,
    defaultAdapterName: string,
    context: HarnessContext,
  ) {
    this.adapters = adapters
    const def = adapters.get(defaultAdapterName)
    if (!def) throw new Error(`Default adapter "${defaultAdapterName}" not found`)
    this.defaultAdapter = def
    this.context = context
  }

  /**
   * Execute a single task directly.
   */
  async direct(task: HarnessTask): Promise<ExecutionResult> {
    const id = randomUUID()
    const start = Date.now()
    const session = new JackClawSession(this.defaultAdapter, task, this.context)

    try {
      const result = await session.run()
      return {
        id,
        mode: 'direct',
        startedAt: start,
        durationMs: Date.now() - start,
        steps: [{
          taskId: task.id,
          title: task.title,
          status: result.status === 'success' ? 'success' : 'failed',
          output: result.output,
        }],
        status: result.status === 'success' ? 'success' : 'failed',
      }
    } catch (err: any) {
      return {
        id,
        mode: 'direct',
        startedAt: start,
        durationMs: Date.now() - start,
        steps: [{
          taskId: task.id,
          title: task.title,
          status: 'failed',
          error: err.message,
        }],
        status: 'failed',
      }
    }
  }

  /**
   * Execute a pipeline: each step's output feeds the next.
   */
  async pipeline(config: PipelineConfig): Promise<ExecutionResult> {
    const id = randomUUID()
    const start = Date.now()
    const steps: StepResult[] = []
    const stopOnFailure = config.stopOnFailure ?? true

    let prevOutput = ''

    for (const step of config.steps) {
      const adapter = step.adapter
        ? this.adapters.get(step.adapter) ?? this.defaultAdapter
        : this.defaultAdapter

      // Inject previous output if transform provided
      const task = { ...step.task }
      if (step.transformInput && prevOutput) {
        task.description = step.transformInput(prevOutput)
      }

      const session = new JackClawSession(adapter, task, this.context)

      try {
        const result = await session.run()
        const succeeded = result.status === 'success'

        steps.push({
          taskId: task.id,
          title: task.title,
          status: succeeded ? 'success' : 'failed',
          output: result.output,
        })

        prevOutput = result.output.stdout ?? ''

        if (!succeeded && stopOnFailure) {
          // Mark remaining as skipped
          const remaining = config.steps.slice(config.steps.indexOf(step) + 1)
          for (const r of remaining) {
            steps.push({ taskId: r.task.id, title: r.task.title, status: 'skipped' })
          }
          break
        }
      } catch (err: any) {
        steps.push({ taskId: task.id, title: task.title, status: 'failed', error: err.message })
        if (stopOnFailure) {
          const remaining = config.steps.slice(config.steps.indexOf(step) + 1)
          for (const r of remaining) {
            steps.push({ taskId: r.task.id, title: r.task.title, status: 'skipped' })
          }
          break
        }
      }
    }

    const allSuccess = steps.every(s => s.status === 'success')
    const anySuccess = steps.some(s => s.status === 'success')

    return {
      id,
      mode: 'pipeline',
      startedAt: start,
      durationMs: Date.now() - start,
      steps,
      status: allSuccess ? 'success' : anySuccess ? 'partial' : 'failed',
    }
  }

  /**
   * Execute multiple tasks in parallel.
   */
  async parallel(config: ParallelConfig): Promise<ExecutionResult> {
    const id = randomUUID()
    const start = Date.now()
    const maxConc = config.maxConcurrency ?? 3
    const collectMode = config.collectMode ?? 'all'

    const results: StepResult[] = []
    const queue = [...config.tasks]

    // Process in batches
    while (queue.length > 0) {
      const batch = queue.splice(0, maxConc)

      const batchPromises = batch.map(async (step) => {
        const adapter = step.adapter
          ? this.adapters.get(step.adapter) ?? this.defaultAdapter
          : this.defaultAdapter

        const session = new JackClawSession(adapter, step.task, this.context)

        try {
          const result = await session.run()
          return {
            taskId: step.task.id,
            title: step.task.title,
            status: result.status === 'success' ? 'success' : 'failed',
            output: result.output,
          } as StepResult
        } catch (err: any) {
          return {
            taskId: step.task.id,
            title: step.task.title,
            status: 'failed',
            error: err.message,
          } as StepResult
        }
      })

      const batchResults = await Promise.all(batchPromises)
      results.push(...batchResults)

      // For first-success mode, stop early
      if (collectMode === 'first-success' && batchResults.some(r => r.status === 'success')) {
        break
      }
    }

    const allSuccess = results.every(s => s.status === 'success')
    const anySuccess = results.some(s => s.status === 'success')

    return {
      id,
      mode: 'parallel',
      startedAt: start,
      durationMs: Date.now() - start,
      steps: results,
      status: allSuccess ? 'success' : anySuccess ? 'partial' : 'failed',
    }
  }
}
