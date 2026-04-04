/**
 * TaskExecutor — LLM Task Execution Engine
 *
 * 负责将结构化任务请求路由到 LLM，支持：
 * - 多任务类型（chat/code/research/analyze/create/custom）
 * - 工具调用循环（function calling）
 * - 流式输出
 * - 任务取消
 * - 执行历史
 */

import { randomUUID } from 'crypto'
import type { AiClient } from './ai-client'
import type { OwnerMemory } from './owner-memory'
import type { ToolDefinition, ToolCallResult } from './tools/index'
import { executeTool, getToolsForLevel } from './tools/index'

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface TaskRequest {
  id: string
  type: 'chat' | 'code' | 'research' | 'analyze' | 'create' | 'custom'
  prompt: string
  context?: string
  tools?: ToolDefinition[]
  model?: string
  maxTokens?: number
  temperature?: number
  stream?: boolean
  /** Permission level for built-in tools: 0=none, 1=web, 2=+files, 3=+shell */
  permissionLevel?: 0 | 1 | 2 | 3
}

export interface TaskResult {
  taskId: string
  status: 'completed' | 'failed' | 'cancelled'
  output: string
  tokenUsage: { input: number; output: number }
  model: string
  duration: number
  toolCalls?: ToolCallResult[]
  error?: string
}

// Internal cancel registry
const activeTasks = new Map<string, AbortController>()

// ─── System Prompts ───────────────────────────────────────────────────────────

function buildSystemPrompt(
  task: TaskRequest,
  ownerContext: string,
): string {
  const role = {
    chat:     'You are a helpful AI assistant. Respond clearly and concisely.',
    code:     'You are an expert software engineer. Write clean, production-ready code with best practices. Include brief explanations when helpful.',
    research: 'You are a thorough research analyst. Gather information, synthesize findings, and present structured summaries with key insights.',
    analyze:  'You are a precise data and systems analyst. Break down problems methodically, identify patterns, and provide actionable conclusions.',
    create:   'You are a creative professional. Produce original, high-quality content tailored to the request.',
    custom:   'You are a capable AI assistant. Follow the user instructions precisely.',
  }[task.type]

  const parts = [role]

  if (ownerContext) {
    parts.push(`\nContext about your principal:\n${ownerContext}`)
  }

  if (task.context) {
    parts.push(`\nTask context:\n${task.context}`)
  }

  return parts.join('\n')
}

// ─── TaskExecutor ─────────────────────────────────────────────────────────────

export class TaskExecutor {
  private history: TaskResult[] = []

  constructor(
    private aiClient: AiClient,
    private ownerMemory: OwnerMemory,
  ) {}

  // ── Main execute ────────────────────────────────────────────────────────────

  async execute(task: TaskRequest): Promise<TaskResult> {
    const tools = task.tools ?? getToolsForLevel(task.permissionLevel ?? 0)
    if (tools.length > 0) {
      return this.executeWithTools(task, tools)
    }

    const start = Date.now()
    const ac = new AbortController()
    activeTasks.set(task.id, ac)

    try {
      const ownerCtx = this._buildOwnerContext()
      const systemPrompt = buildSystemPrompt(task, ownerCtx)

      const result = await this.aiClient.call({
        systemPrompt,
        messages: [{ role: 'user', content: task.prompt }],
        model: task.model,
        maxTokens: task.maxTokens ?? 4096,
      })

      const taskResult: TaskResult = {
        taskId: task.id,
        status: 'completed',
        output: result.content,
        tokenUsage: {
          input: result.usage.inputTokens,
          output: result.usage.outputTokens,
        },
        model: task.model ?? 'default',
        duration: Date.now() - start,
      }

      this.history.unshift(taskResult)
      if (this.history.length > 100) this.history.pop()

      return taskResult
    } catch (err: any) {
      const taskResult: TaskResult = {
        taskId: task.id,
        status: ac.signal.aborted ? 'cancelled' : 'failed',
        output: '',
        tokenUsage: { input: 0, output: 0 },
        model: task.model ?? 'default',
        duration: Date.now() - start,
        error: (err as Error).message,
      }
      this.history.unshift(taskResult)
      return taskResult
    } finally {
      activeTasks.delete(task.id)
    }
  }

  // ── Tool-use loop ────────────────────────────────────────────────────────────

  async executeWithTools(task: TaskRequest, tools: ToolDefinition[]): Promise<TaskResult> {
    const start = Date.now()
    const ac = new AbortController()
    activeTasks.set(task.id, ac)

    const allToolCalls: ToolCallResult[] = []
    let totalInput = 0
    let totalOutput = 0
    let usedModel = task.model ?? 'default'

    try {
      const ownerCtx = this._buildOwnerContext()
      const systemPrompt = buildSystemPrompt(task, ownerCtx)

      // Convert ToolDefinitions to Anthropic tool format
      const toolDefs = tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }))

      const messages: Array<{ role: string; content: unknown }> = [
        { role: 'user', content: task.prompt },
      ]

      const MAX_ROUNDS = 10
      let finalText = ''

      for (let round = 0; round < MAX_ROUNDS; round++) {
        if (ac.signal.aborted) throw new Error('Task cancelled')

        const res = await this.aiClient.chatWithTools(messages as any, toolDefs, {
          systemPrompt,
          model: task.model,
          maxTokens: task.maxTokens ?? 4096,
        })

        totalInput += res.usage.inputTokens
        totalOutput += res.usage.outputTokens
        usedModel = res.model

        if (res.stopReason === 'end_turn' || !res.toolUses?.length) {
          finalText = res.content
          break
        }

        // Append assistant message
        messages.push({ role: 'assistant', content: res.rawContent })

        // Execute tool calls
        const toolResults: Array<{ type: string; tool_use_id: string; content: string }> = []
        for (const toolUse of res.toolUses) {
          const toolResult = await executeTool(
            toolUse.name,
            toolUse.input as Record<string, unknown>,
            task.permissionLevel ?? 0,
          )
          allToolCalls.push(toolResult)
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: toolResult.error
              ? `Error: ${toolResult.error}`
              : toolResult.result,
          })
        }

        messages.push({ role: 'user', content: toolResults })

        if (!res.toolUses.length) {
          finalText = res.content
          break
        }
      }

      const taskResult: TaskResult = {
        taskId: task.id,
        status: 'completed',
        output: finalText,
        tokenUsage: { input: totalInput, output: totalOutput },
        model: usedModel,
        duration: Date.now() - start,
        toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
      }

      this.history.unshift(taskResult)
      if (this.history.length > 100) this.history.pop()
      return taskResult
    } catch (err) {
      const taskResult: TaskResult = {
        taskId: task.id,
        status: ac.signal.aborted ? 'cancelled' : 'failed',
        output: '',
        tokenUsage: { input: totalInput, output: totalOutput },
        model: usedModel,
        duration: Date.now() - start,
        error: (err as Error).message,
        toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
      }
      this.history.unshift(taskResult)
      return taskResult
    } finally {
      activeTasks.delete(task.id)
    }
  }

  // ── Streaming ────────────────────────────────────────────────────────────────

  async *stream(task: TaskRequest): AsyncGenerator<string> {
    const ownerCtx = this._buildOwnerContext()
    const systemPrompt = buildSystemPrompt(task, ownerCtx)
    const ac = new AbortController()
    activeTasks.set(task.id, ac)

    try {
      yield* this.aiClient.stream(
        [{ role: 'user', content: task.prompt }],
        {
          systemPrompt,
          model: task.model,
          maxTokens: task.maxTokens ?? 4096,
          signal: ac.signal,
        },
      )
    } finally {
      activeTasks.delete(task.id)
    }
  }

  // ── Cancel ───────────────────────────────────────────────────────────────────

  cancel(taskId: string): void {
    const ac = activeTasks.get(taskId)
    if (ac) {
      ac.abort()
      activeTasks.delete(taskId)
      console.log(`[task-executor] Cancelled task ${taskId}`)
    }
  }

  // ── History ──────────────────────────────────────────────────────────────────

  getHistory(limit = 20): TaskResult[] {
    return this.history.slice(0, limit)
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private _buildOwnerContext(): string {
    try {
      const entries = this.ownerMemory.get()
      if (!entries.length) return ''
      return entries
        .slice(0, 10)
        .map(e => `[${e.type}] ${e.content}`)
        .join('\n')
    } catch {
      return ''
    }
  }
}

// ─── Singleton factory ────────────────────────────────────────────────────────

const executors = new Map<string, TaskExecutor>()

export function getTaskExecutor(
  nodeId: string,
  aiClient: AiClient,
  ownerMemory: OwnerMemory,
): TaskExecutor {
  if (!executors.has(nodeId)) {
    executors.set(nodeId, new TaskExecutor(aiClient, ownerMemory))
  }
  return executors.get(nodeId)!
}

export function createTaskRequest(
  prompt: string,
  type: TaskRequest['type'] = 'chat',
  overrides: Partial<TaskRequest> = {},
): TaskRequest {
  return {
    id: randomUUID(),
    type,
    prompt,
    ...overrides,
  }
}
