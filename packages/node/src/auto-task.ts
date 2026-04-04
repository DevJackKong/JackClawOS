/**
 * auto-task.ts — AutoTaskRunner: autonomous task chain executor
 *
 * Decomposes a high-level goal into sub-steps via LLM, then executes them
 * sequentially, feeding each step's result as context for the next.
 * Supports pause-for-human, per-step retry, and persistence for resume.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID } from 'crypto'
import type { JackClawConfig } from './config'
import { getAiClient } from './ai-client'
import type { Message } from './smart-cache'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SubTask {
  step: number
  description: string
  type: 'llm' | 'tool' | 'ask_human'
  tool?: string
  args?: any
  dependsOn?: number[]
  status: 'pending' | 'running' | 'completed' | 'failed'
  result?: string
  error?: string
  attempts?: number
}

export interface AutoTaskResult {
  goal: string
  taskId: string
  steps: SubTask[]
  finalOutput: string
  totalTokens: { input: number; output: number }
  duration: number   // ms
  status: 'completed' | 'failed' | 'paused_for_human'
}

export interface AutoTaskOptions {
  /** Call onStepComplete after each step. Default: true */
  notifyOwner?: boolean
  /** Stop after this many steps (prevent infinite loops). Default: 10 */
  maxSteps?: number
  /** Per-step retry limit. Default: 3 */
  maxRetries?: number
  /** Override the default LLM model */
  model?: string
  /** Called after each completed step when notifyOwner is true */
  onStepComplete?: (step: SubTask) => void | Promise<void>
}

// ─── Persistence ──────────────────────────────────────────────────────────────

const TASKS_DIR = path.join(os.homedir(), '.jackclaw', 'node', 'auto-tasks')

interface PersistedTask {
  goal: string
  taskId: string
  steps: SubTask[]
  status: AutoTaskResult['status']
  startedAt: number
}

function saveTask(task: PersistedTask): void {
  fs.mkdirSync(TASKS_DIR, { recursive: true })
  fs.writeFileSync(
    path.join(TASKS_DIR, `${task.taskId}.json`),
    JSON.stringify(task, null, 2),
  )
}

function loadTask(taskId: string): PersistedTask | null {
  const file = path.join(TASKS_DIR, `${taskId}.json`)
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as PersistedTask
  } catch {
    return null
  }
}

// ─── AutoTaskRunner ───────────────────────────────────────────────────────────

export class AutoTaskRunner {
  private aiClient: ReturnType<typeof getAiClient>
  private opts: Required<AutoTaskOptions>

  constructor(
    private nodeId: string,
    private config: JackClawConfig,
    opts?: AutoTaskOptions,
  ) {
    this.aiClient = getAiClient(nodeId, config)
    this.opts = {
      notifyOwner: opts?.notifyOwner ?? true,
      maxSteps: opts?.maxSteps ?? 10,
      maxRetries: opts?.maxRetries ?? 3,
      model: opts?.model ?? config.ai.model,
      onStepComplete: opts?.onStepComplete ?? (() => {}),
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Decompose goal into sub-tasks, then execute all of them in sequence. */
  async run(goal: string): Promise<AutoTaskResult> {
    const taskId = randomUUID()
    const startedAt = Date.now()

    const steps = await this.plan(goal)

    // Persist initial state
    saveTask({ goal, taskId, steps, status: 'completed', startedAt })

    return this._execute(goal, taskId, steps, startedAt)
  }

  /** Only plan — decompose goal into sub-tasks without executing. */
  async plan(goal: string): Promise<SubTask[]> {
    const systemPrompt = `You are a task decomposition expert.
Break down the given goal into clear, sequential steps that an AI agent can execute.
Output ONLY a JSON array — no explanations, no markdown fences.`

    const prompt = `Goal: ${goal}

Decompose into sequential steps (max ${this.opts.maxSteps}). Output a JSON array:
[
  { "step": 1, "description": "...", "type": "llm" },
  { "step": 2, "description": "...", "type": "llm", "dependsOn": [1] }
]

Rules:
- type "llm"        = AI reasoning / text generation
- type "tool"       = external tool call (add "tool" and "args" fields)
- type "ask_human"  = requires human input before proceeding
- Maximum ${this.opts.maxSteps} steps
- Each step must be concrete and actionable`

    const result = await this.aiClient.call({
      systemPrompt,
      messages: [{ role: 'user', content: prompt }],
      model: this.opts.model,
      maxTokens: 2048,
    })

    return this._parsePlan(result.content)
  }

  /** Resume a paused or interrupted task by its taskId. */
  async resume(taskId: string): Promise<AutoTaskResult> {
    const persisted = loadTask(taskId)
    if (!persisted) {
      throw new Error(`Task not found: ${taskId}`)
    }
    // Reset failed/running steps back to pending so they're retried
    for (const step of persisted.steps) {
      if (step.status === 'running' || step.status === 'failed') {
        step.status = 'pending'
        step.error = undefined
        step.attempts = 0
      }
    }
    return this._execute(persisted.goal, taskId, persisted.steps, persisted.startedAt)
  }

  // ── Execution engine ────────────────────────────────────────────────────────

  private async _execute(
    goal: string,
    taskId: string,
    steps: SubTask[],
    startedAt: number,
  ): Promise<AutoTaskResult> {
    const totalTokens = { input: 0, output: 0 }
    const contextParts: string[] = [`Goal: ${goal}`]
    let finalOutput = ''
    let taskStatus: AutoTaskResult['status'] = 'completed'

    for (const step of steps) {
      if (step.status === 'completed') {
        // Already done (resuming) — include prior result in context
        if (step.result) contextParts.push(`Step ${step.step} result: ${step.result}`)
        continue
      }

      // Guard: total steps executed (pending → completed) capped at maxSteps
      const executedCount = steps.filter(s => s.status === 'completed').length
      if (executedCount >= this.opts.maxSteps) {
        step.status = 'failed'
        step.error = 'maxSteps limit reached'
        finalOutput = `Stopped after ${this.opts.maxSteps} steps (limit reached). Last output: ${contextParts[contextParts.length - 1] ?? ''}`
        taskStatus = 'failed'
        break
      }

      // Pause for human
      if (step.type === 'ask_human') {
        step.status = 'pending'
        finalOutput = `Paused at step ${step.step}: "${step.description}". Human input required.`
        taskStatus = 'paused_for_human'
        saveTask({ goal, taskId, steps, status: taskStatus, startedAt })
        break
      }

      // Execute with retry
      step.status = 'running'
      step.attempts = 0
      let lastError = ''

      for (let attempt = 1; attempt <= this.opts.maxRetries; attempt++) {
        step.attempts = attempt
        try {
          const { result, tokens } = await this._executeStep(step, contextParts.join('\n\n'))
          step.result = result
          step.status = 'completed'
          totalTokens.input += tokens.input
          totalTokens.output += tokens.output
          contextParts.push(`Step ${step.step} result: ${result}`)
          finalOutput = result
          lastError = ''
          break
        } catch (err: any) {
          lastError = err?.message ?? String(err)
          console.warn(`[auto-task] step=${step.step} attempt=${attempt} error: ${lastError}`)
          if (attempt < this.opts.maxRetries) {
            await new Promise(r => setTimeout(r, 500 * attempt))
          }
        }
      }

      if (step.status !== 'completed') {
        step.status = 'failed'
        step.error = lastError
        finalOutput = `Failed at step ${step.step}: ${lastError}`
        taskStatus = 'failed'
        break
      }

      // Notify owner
      if (this.opts.notifyOwner) {
        try {
          await this.opts.onStepComplete(step)
        } catch (notifyErr: any) {
          console.warn('[auto-task] onStepComplete error:', notifyErr?.message)
        }
      }

      // Persist progress after each step
      saveTask({ goal, taskId, steps, status: taskStatus, startedAt })
    }

    const result: AutoTaskResult = {
      goal,
      taskId,
      steps,
      finalOutput,
      totalTokens,
      duration: Date.now() - startedAt,
      status: taskStatus,
    }

    saveTask({ goal, taskId, steps, status: taskStatus, startedAt })
    return result
  }

  private async _executeStep(
    step: SubTask,
    context: string,
  ): Promise<{ result: string; tokens: { input: number; output: number } }> {
    if (step.type === 'tool') {
      // Tools are not wired here — callers can override onStepComplete to handle them.
      // Return a placeholder so the chain can continue.
      return {
        result: `[tool:${step.tool ?? 'unknown'}] args=${JSON.stringify(step.args ?? {})} (tool execution not implemented)`,
        tokens: { input: 0, output: 0 },
      }
    }

    // type === 'llm'
    const messages: Message[] = [
      {
        role: 'user',
        content: `Context so far:\n${context}\n\nCurrent task:\n${step.description}\n\nComplete this step concisely.`,
      },
    ]

    const aiResult = await this.aiClient.call({
      systemPrompt: 'You are a focused AI assistant executing one step of a larger task. Be concise and precise.',
      messages,
      model: this.opts.model,
      maxTokens: 2048,
    })

    return {
      result: aiResult.content,
      tokens: {
        input: aiResult.usage.inputTokens,
        output: aiResult.usage.outputTokens,
      },
    }
  }

  // ── Plan parsing ────────────────────────────────────────────────────────────

  private _parsePlan(raw: string): SubTask[] {
    // Extract JSON array, tolerating markdown code fences
    const match = raw.match(/\[[\s\S]*\]/)
    if (!match) {
      // Fallback: treat the entire goal as one LLM step
      return [{
        step: 1,
        description: 'Execute the goal directly',
        type: 'llm',
        status: 'pending',
      }]
    }

    try {
      const parsed = JSON.parse(match[0]) as Array<{
        step: number
        description: string
        type?: string
        tool?: string
        args?: any
        dependsOn?: number[]
      }>

      return parsed.slice(0, this.opts.maxSteps).map((s) => ({
        step: s.step,
        description: s.description,
        type: (s.type === 'tool' || s.type === 'ask_human') ? s.type : 'llm',
        tool: s.tool,
        args: s.args,
        dependsOn: s.dependsOn,
        status: 'pending' as const,
      }))
    } catch {
      return [{
        step: 1,
        description: 'Execute the goal directly',
        type: 'llm',
        status: 'pending',
      }]
    }
  }
}
