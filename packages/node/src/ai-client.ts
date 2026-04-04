/**
 * JackClaw AI Client — SmartCache 原生集成
 *
 * 所有 LLM 调用统一走这里。自动：
 * 1. 探测中转站缓存能力（首次 + 每24h）
 * 2. 按能力选择最优 payload 策略（native/compressed/sliding）
 * 3. 记录 token 使用 + 统计节省量
 */

import { randomUUID } from 'crypto'
import type { JackClawConfig } from './config'
import { getSmartCache, type CacheCapability, type Message } from './smart-cache'
import { classifyResponse, rewritePrompt } from './auto-retry'

export interface MemoryEntry {
  type: 'user' | 'feedback' | 'project' | 'reference'
  content: string
  tags?: string[]
}

export interface AiCallOptions {
  systemPrompt: string
  memoryEntries?: MemoryEntry[]
  messages: Message[]
  queryContext?: string    // 当前用户意图，用于过滤相关 memory
  maxTokens?: number
  model?: string           // override config model
  retry?: {
    enabled?: boolean      // 默认 true
    maxAttempts?: number   // 默认 3
    successEvaluator?: (response: string) => boolean
    contextExtractor?: () => string
  }
}

export interface AiCallResult {
  content: string
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    savedTokens: number
  }
  strategy: string
  attempts: number          // 实际使用了几轮（1 = 一次成功）
  retryHistory?: Array<{ attempt: number; failureType: string; summary: string }>
}

export class AiClient {
  private cache
  private capability: CacheCapability | null = null
  private lastProbeTime = 0

  constructor(
    private nodeId: string,
    private config: JackClawConfig,
  ) {
    this.cache = getSmartCache(nodeId)
  }

  async call(opts: AiCallOptions): Promise<AiCallResult> {
    await this.ensureCapabilityProbed()

    const retryEnabled = opts.retry?.enabled !== false
    const maxAttempts = opts.retry?.maxAttempts ?? 3

    let currentMessages = opts.messages
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let totalSavedTokens = 0
    let lastCacheRead = 0
    let lastCacheWrite = 0
    let lastStrategy = 'full'
    let lastContent = ''
    const retryHistory: AiCallResult['retryHistory'] = []

    for (let attempt = 1; attempt <= (retryEnabled ? maxAttempts : 1); attempt++) {
      const result = await this._singleCall({ ...opts, messages: currentMessages })

      totalInputTokens += result.usage.inputTokens
      totalOutputTokens += result.usage.outputTokens
      totalSavedTokens += result.usage.savedTokens
      lastCacheRead = result.usage.cacheReadTokens
      lastCacheWrite = result.usage.cacheWriteTokens
      lastStrategy = result.strategy
      lastContent = result.content

      // 自定义成功判断
      if (opts.retry?.successEvaluator?.(result.content)) break

      const failureType = classifyResponse(result.content)

      if (failureType === 'success') break

      retryHistory.push({ attempt, failureType, summary: result.content.slice(0, 100) })
      console.log(`[ai-client] attempt=${attempt} failure=${failureType}, retrying...`)

      // hard fail 不重试
      if (failureType === 'hard-capability' || failureType === 'hard-policy') break
      if (attempt === maxAttempts) break

      // 重写 prompt
      const contextHints = failureType === 'soft-context'
        ? opts.retry?.contextExtractor?.()
        : undefined
      currentMessages = rewritePrompt(currentMessages, failureType, result.content, attempt, contextHints)
    }

    return {
      content: lastContent,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cacheReadTokens: lastCacheRead,
        cacheWriteTokens: lastCacheWrite,
        savedTokens: totalSavedTokens,
      },
      strategy: lastStrategy,
      attempts: retryHistory.length + 1,
      retryHistory: retryHistory.length > 0 ? retryHistory : undefined,
    }
  }

  /** 单次 API 调用（不含重试逻辑） */
  private async _singleCall(opts: AiCallOptions): Promise<AiCallResult> {
    const { ai } = this.config
    const payload = this.cache.buildOptimalPayload({
      systemPrompt: opts.systemPrompt,
      memoryEntries: opts.memoryEntries ?? [],
      messages: opts.messages,
      queryContext: opts.queryContext,
      capability: this.capability!,
      maxMemoryEntries: ai.maxMemoryEntries,
    })

    // 3. 发送请求
    const model = opts.model ?? ai.model
    const requestId = randomUUID()

    const body: Record<string, unknown> = {
      model,
      max_tokens: opts.maxTokens ?? 4096,
      system: payload.cacheControl
        ? [{ type: 'text', text: payload.systemPrompt, cache_control: payload.cacheControl }]
        : payload.systemPrompt,
      messages: payload.messages,
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ai.authToken}`,
      'anthropic-version': '2023-06-01',
    }
    if (this.capability === 'native') {
      headers['anthropic-beta'] = 'prompt-caching-2024-07-31'
    }

    const res = await fetch(`${ai.baseUrl}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`AI API error ${res.status}: ${errText}`)
    }

    const data = await res.json() as any
    const usage = data.usage ?? {}
    const inputTokens: number = usage.input_tokens ?? 0
    const outputTokens: number = usage.output_tokens ?? 0
    const cacheReadTokens: number = usage.cache_read_input_tokens ?? 0
    const cacheWriteTokens: number = usage.cache_creation_input_tokens ?? 0

    // 4. 记录使用量
    this.cache.trackUsage({
      requestId,
      model,
      provider: new URL(ai.baseUrl).hostname,
      strategy: payload.strategy,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      savedTokens: payload.savedTokens,
      timestamp: Date.now(),
    })

    const content = data.content?.[0]?.text ?? ''
    return {
      content,
      usage: {
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        savedTokens: payload.savedTokens,
      },
      strategy: payload.strategy,
      attempts: 1,
    }
  }

  /**
   * 获取 token 节省报告（可推送到 Hub）
   */
  getSavingsReport(period: 'today' | '7d' | '30d' | 'all' = 'today') {
    return this.cache.getSavingsReport(period)
  }

  // ── Tool-use support ─────────────────────────────────────────────────────────

  /** 带工具定义的单次调用，返回包含工具调用信息的完整响应 */
  async chatWithTools(
    messages: Message[],
    tools: Array<{ name: string; description: string; input_schema: unknown }>,
    opts: { systemPrompt?: string; model?: string; maxTokens?: number } = {},
  ): Promise<{
    content: string
    rawContent: unknown
    stopReason: string
    toolUses: Array<{ id: string; name: string; input: unknown }>
    usage: { inputTokens: number; outputTokens: number }
    model: string
  }> {
    await this.ensureCapabilityProbed()
    const { ai } = this.config
    const model = opts.model ?? ai.model

    const body: Record<string, unknown> = {
      model,
      max_tokens: opts.maxTokens ?? 4096,
      tools,
      messages,
    }
    if (opts.systemPrompt) body.system = opts.systemPrompt

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ai.authToken}`,
      'anthropic-version': '2023-06-01',
    }

    const res = await fetch(`${ai.baseUrl}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`AI API error ${res.status}: ${errText}`)
    }

    const data = await res.json() as any
    const usage = data.usage ?? {}
    const rawContent = data.content ?? []
    const textBlocks = (rawContent as any[]).filter((b: any) => b.type === 'text')
    const toolUseBlocks = (rawContent as any[]).filter((b: any) => b.type === 'tool_use')

    return {
      content: textBlocks.map((b: any) => b.text).join(''),
      rawContent,
      stopReason: data.stop_reason ?? 'end_turn',
      toolUses: toolUseBlocks.map((b: any) => ({ id: b.id, name: b.name, input: b.input })),
      usage: { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 },
      model,
    }
  }

  /** 流式输出 — AsyncGenerator，每次 yield 一个文本 delta */
  async *stream(
    messages: Message[],
    opts: { systemPrompt?: string; model?: string; maxTokens?: number; signal?: AbortSignal } = {},
  ): AsyncGenerator<string> {
    await this.ensureCapabilityProbed()
    const { ai } = this.config
    const model = opts.model ?? ai.model

    const body: Record<string, unknown> = {
      model,
      max_tokens: opts.maxTokens ?? 4096,
      stream: true,
      messages,
    }
    if (opts.systemPrompt) body.system = opts.systemPrompt

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ai.authToken}`,
      'anthropic-version': '2023-06-01',
    }

    const res = await fetch(`${ai.baseUrl}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: opts.signal,
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Stream AI API error ${res.status}: ${errText}`)
    }

    const reader = res.body?.getReader()
    if (!reader) throw new Error('No response body for streaming')

    const decoder = new TextDecoder()
    let buf = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const json = line.slice(6).trim()
          if (json === '[DONE]') return
          try {
            const evt = JSON.parse(json)
            const delta = evt?.delta?.text
            if (typeof delta === 'string' && delta) yield delta
          } catch {
            // ignore malformed SSE lines
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  // ── OrgNorm 注入 ─────────────────────────────────────────────────────────────

  /** 从 Hub 拉取 OrgNorm 的缓存（5 分钟 TTL） */
  private _normCache: { inject: string; fetchedAt: number } | null = null
  private readonly NORM_TTL_MS = 5 * 60 * 1000   // 5 minutes

  /**
   * callWithNorms — 自动从 Hub 拉取当前 OrgNorm 并注入 system prompt，然后执行 AI 调用。
   * 拉取结果缓存 5 分钟，避免每次都发 HTTP 请求。
   */
  async callWithNorms(opts: AiCallOptions & { role?: string }): Promise<AiCallResult> {
    const inject = await this._fetchNormInject(opts.role ?? 'worker')
    const enrichedSystem = inject
      ? `${inject}\n\n${opts.systemPrompt}`
      : opts.systemPrompt

    return this.call({ ...opts, systemPrompt: enrichedSystem })
  }

  private async _fetchNormInject(role: string): Promise<string> {
    const now = Date.now()
    if (this._normCache && now - this._normCache.fetchedAt < this.NORM_TTL_MS) {
      return this._normCache.inject
    }

    const hubUrl = this.config.hubUrl
    try {
      const res = await fetch(`${hubUrl}/api/org-norm?role=${encodeURIComponent(role)}`, {
        headers: { 'Authorization': `Bearer ${(this.config as any).hubToken ?? ''}` },
      })
      if (!res.ok) {
        console.warn(`[ai-client] OrgNorm fetch failed: ${res.status}`)
        return ''
      }
      const data = await res.json() as { norms?: Array<{ rule: string }> }
      const norms = data.norms ?? []
      const inject = norms.length > 0
        ? `ORGANIZATION NORMS:\n${norms.map(n => `- ${n.rule}`).join('\n')}`
        : ''
      this._normCache = { inject, fetchedAt: now }
      return inject
    } catch (err) {
      console.warn('[ai-client] OrgNorm fetch error:', (err as Error).message)
      return ''
    }
  }

  private async ensureCapabilityProbed(): Promise<void> {
    const { ai } = this.config
    const now = Date.now()
    if (this.capability && now - this.lastProbeTime < ai.cacheProbeInterval) return

    const result = await this.cache.detectCacheSupport(ai.baseUrl, ai.authToken, ai.model)
    this.capability = result.capability
    this.lastProbeTime = now

    console.log(`[ai-client] Cache capability: ${this.capability} (provider: ${result.provider})`)
    if (this.capability === 'none') {
      console.log('[ai-client] SmartCache compression active — local memory filtering enabled')
    }
  }
}

// 单例工厂（每个 nodeId 一个实例）
const clients = new Map<string, AiClient>()
export function getAiClient(nodeId: string, config: JackClawConfig): AiClient {
  if (!clients.has(nodeId)) {
    clients.set(nodeId, new AiClient(nodeId, config))
  }
  return clients.get(nodeId)!
}
