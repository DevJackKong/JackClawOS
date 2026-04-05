/**
 * LLMGateway — Routes requests to the right provider
 *
 * Features:
 * - Auto-detect provider from model name
 * - Fallback chain (try next on error)
 * - Cost estimation
 * - Request logging
 */
import type {
  LLMProvider, ChatRequest, ChatResponse,
  GatewayConfig, ProviderConfig
} from './types.js'
import { OpenAICompatibleProvider } from './providers/openai-compatible.js'
import { AnthropicProvider } from './providers/anthropic.js'
import { GoogleProvider } from './providers/google.js'
import { QwenProvider } from './providers/qwen.js'
import { ErnieProvider } from './providers/ernie.js'
import { HunyuanProvider } from './providers/hunyuan.js'
import { SparkProvider } from './providers/spark.js'
import { KimiProvider } from './providers/kimi.js'
import { ZhipuProvider } from './providers/zhipu.js'
import { BaichuanProvider } from './providers/baichuan.js'
import { OllamaProvider } from './providers/ollama.js'
import { OpenClawProvider } from './providers/openclaw.js'

// ─── Cost per 1M tokens (USD) ────────────────────────────────────────
const PRICE_TABLE: Record<string, { input: number; output: number }> = {
  // OpenAI
  'gpt-4o':              { input: 5.00,   output: 15.00 },
  'gpt-4o-mini':         { input: 0.15,   output: 0.60  },
  'o1':                  { input: 15.00,  output: 60.00 },
  'o3-mini':             { input: 1.10,   output: 4.40  },
  // Anthropic
  'claude-opus-4':       { input: 15.00,  output: 75.00 },
  'claude-sonnet-4-6':   { input: 3.00,   output: 15.00 },
  'claude-haiku-3-5':    { input: 0.80,   output: 4.00  },
  // Google
  'gemini-2.0-flash':    { input: 0.075,  output: 0.30  },
  'gemini-1.5-pro':      { input: 1.25,   output: 5.00  },
  'gemini-1.5-flash':    { input: 0.075,  output: 0.30  },
  // DeepSeek
  'deepseek-chat':       { input: 0.27,   output: 1.10  },
  'deepseek-reasoner':   { input: 0.55,   output: 2.19  },
  // Groq (free tier, very cheap)
  'llama-3.3-70b-versatile':    { input: 0.59,  output: 0.79 },
  'mixtral-8x7b-32768':         { input: 0.24,  output: 0.24 },
  // ── 国内模型 ──
  // 通义千问 (Qwen)
  'qwen-max':                   { input: 0.56,  output: 2.24 },
  'qwen-plus':                  { input: 0.11,  output: 0.34 },
  'qwen-turbo':                 { input: 0.056, output: 0.14 },
  // 文心一言 (ERNIE)
  'ernie-4.5-turbo':            { input: 0.28,  output: 0.28 },
  'ernie-4.0':                  { input: 0.42,  output: 0.42 },
  // 混元 (Hunyuan)
  'hunyuan-pro':                { input: 0.98,  output: 2.80 },
  'hunyuan-turbo':              { input: 0.28,  output: 0.84 },
  'hunyuan-standard':           { input: 0.14,  output: 0.28 },
  // Kimi (Moonshot)
  'moonshot-v1-8k':             { input: 0.17,  output: 0.17 },
  'moonshot-v1-32k':            { input: 0.35,  output: 0.35 },
  'moonshot-v1-128k':           { input: 1.40,  output: 1.40 },
  // 智谱 GLM
  'glm-4':                      { input: 0.98,  output: 0.98 },
  'glm-4-flash':                { input: 0,     output: 0    }, // 免费
  'glm-4-air':                  { input: 0.014, output: 0.014 },
  // 讯飞星火
  'generalv3.5':                { input: 0.21,  output: 0.21 },
  // Ollama (local = free)
  'llama3':              { input: 0, output: 0 },
  'mistral':             { input: 0, output: 0 },
  'qwen2.5':             { input: 0, output: 0 },
}

export interface GatewayStats {
  totalRequests: number
  totalTokens: number
  totalCostUsd: number
  byProvider: Record<string, { requests: number; tokens: number; costUsd: number }>
}

export class LLMGateway {
  private providers = new Map<string, LLMProvider>()
  private config: GatewayConfig
  private stats: GatewayStats = {
    totalRequests: 0, totalTokens: 0, totalCostUsd: 0, byProvider: {}
  }

  constructor(config: GatewayConfig) {
    this.config = config
    for (const pc of config.providers) {
      this.providers.set(pc.provider, this.createProvider(pc))
    }
  }

  // ─── Main entry point ─────────────────────────────────────────────

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const provider = this.resolveProvider(request.model)
    const chain = this.config.fallbackChain ?? []

    // Try primary provider
    try {
      return await this.chatWithProvider(provider, request)
    } catch (err: any) {
      if (!chain.length) throw err
      console.warn(`[gateway] ${provider.name} failed: ${err.message}. Trying fallback chain...`)
    }

    // Fallback chain
    for (const fallbackName of chain) {
      const fallback = this.providers.get(fallbackName)
      if (!fallback || fallback === provider) continue
      try {
        console.log(`[gateway] Trying fallback: ${fallbackName}`)
        return await this.chatWithProvider(fallback, request, true)
      } catch (err: any) {
        console.warn(`[gateway] ${fallbackName} also failed: ${err.message}`)
      }
    }

    throw new Error(`[gateway] All providers failed for model: ${request.model}`)
  }

  // ─── Provider resolution ──────────────────────────────────────────

  resolveProvider(model: string): LLMProvider {
    // 1. Explicit routing rules
    if (this.config.routing) {
      for (const rule of this.config.routing) {
        if (new RegExp(rule.pattern, 'i').test(model)) {
          const p = this.providers.get(rule.provider)
          if (p) return p
        }
      }
    }

    // 2. Model-prefix auto-detect
    if (model.startsWith('claude'))      return this.get('anthropic')
    if (model.startsWith('gemini'))      return this.get('google')
    if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3'))
                                          return this.get('openai')
    if (model.startsWith('deepseek'))    return this.get('deepseek')
    if (model.startsWith('llama') || model.startsWith('mixtral') || model.startsWith('gemma'))
                                          return this.get('groq') ?? this.get('ollama') ?? this.getDefault()
    if (model.startsWith('qwen'))        return this.get('qwen')
    if (model.startsWith('ernie'))       return this.get('ernie')
    if (model.startsWith('hunyuan'))     return this.get('hunyuan')
    if (model.startsWith('general'))     return this.get('spark')  // 星火
    if (model.startsWith('moonshot'))    return this.get('kimi')
    if (model.startsWith('glm'))         return this.get('zhipu')
    if (model.startsWith('Baichuan'))    return this.get('baichuan')
    if (model.startsWith('yi-'))         return this.get('openrouter') ?? this.getDefault()
    if (model.startsWith('qwen') || model.startsWith('yi') || model.startsWith('moonshot'))
                                          return this.get('openrouter') ?? this.getDefault()

    // 3. Default
    return this.getDefault()
  }

  // ─── Convenience shortcuts ────────────────────────────────────────

  /** Fastest cheap model: GPT-4o-mini / Gemini Flash / DeepSeek */
  async fast(prompt: string, systemPrompt?: string): Promise<string> {
    const model = this.pickModel(['gpt-4o-mini', 'gemini-2.0-flash', 'deepseek-chat', 'llama3'])
    return this.simple(model, prompt, systemPrompt)
  }

  /** Best quality: GPT-4o / Claude Sonnet / Gemini Pro */
  async smart(prompt: string, systemPrompt?: string): Promise<string> {
    const model = this.pickModel(['gpt-4o', 'claude-sonnet-4-6', 'gemini-1.5-pro'])
    return this.simple(model, prompt, systemPrompt)
  }

  /** Free local (Ollama) — fastest, no API cost */
  async local(prompt: string, model = 'llama3', systemPrompt?: string): Promise<string> {
    return this.simple(model, prompt, systemPrompt)
  }

  /** Get text content from chat response */
  async simple(model: string, prompt: string, systemPrompt?: string): Promise<string> {
    const messages = systemPrompt
      ? [{ role: 'system' as const, content: systemPrompt }, { role: 'user' as const, content: prompt }]
      : [{ role: 'user' as const, content: prompt }]
    const resp = await this.chat({ model, messages })
    return resp.choices[0]?.message.content ?? ''
  }

  /**
   * Try a prioritised list of providers with the given prompt.
   * Returns the first successful response text.
   * Each provider is attempted using its default/first configured model.
   */
  async withFallback(providerNames: string[], prompt: string, systemPrompt?: string): Promise<string> {
    const messages = systemPrompt
      ? [{ role: 'system' as const, content: systemPrompt }, { role: 'user' as const, content: prompt }]
      : [{ role: 'user' as const, content: prompt }]

    let lastErr: Error | undefined
    for (let i = 0; i < providerNames.length; i++) {
      const name = providerNames[i]
      const provider = this.providers.get(name)
      if (!provider) {
        console.warn(`[gateway] withFallback: provider not found: ${name}, skipping`)
        continue
      }
      const model = provider.models[0] ?? name
      try {
        const resp = await this.chatWithProvider(provider, { model, messages }, i > 0)
        return resp.choices[0]?.message.content ?? ''
      } catch (err: any) {
        console.warn(`[gateway] withFallback: ${name} failed: ${err.message}`)
        lastErr = err
      }
    }
    throw lastErr ?? new Error('[gateway] withFallback: all providers failed')
  }

  // ─── Stats & cost ─────────────────────────────────────────────────

  getStats(): GatewayStats { return { ...this.stats } }

  estimateCost(model: string, promptTokens: number, completionTokens: number): number {
    // Fuzzy match
    const key = Object.keys(PRICE_TABLE).find(k => model.includes(k) || k.includes(model.split('-').slice(0,2).join('-')))
    if (!key) return 0
    const p = PRICE_TABLE[key]
    return (promptTokens * p.input + completionTokens * p.output) / 1_000_000
  }

  // ─── Provider management ──────────────────────────────────────────

  addProvider(config: ProviderConfig): void {
    this.providers.set(config.provider, this.createProvider(config))
  }

  listProviders(): string[] {
    return [...this.providers.keys()]
  }

  async pingAll(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {}
    await Promise.all([...this.providers.entries()].map(async ([name, p]) => {
      results[name] = await p.isAvailable().catch(() => false)
    }))
    return results
  }

  // ─── Private helpers ──────────────────────────────────────────────

  private withTimeout<T>(ms: number, promise: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Gateway timeout after ${ms}ms`)), ms)
      promise.then(
        v => { clearTimeout(timer); resolve(v) },
        e => { clearTimeout(timer); reject(e) },
      )
    })
  }

  /** 4xx = client error, do not retry. Network errors / timeouts = retryable. */
  private isRetryable(err: Error): boolean {
    return !/api error 4\d\d/i.test(err.message)
  }

  private async withRetry<T>(fn: () => Promise<T>, maxAttempts: number, baseDelayMs = 500): Promise<T> {
    let lastErr!: Error
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await fn()
      } catch (err: any) {
        lastErr = err
        if (!this.isRetryable(err)) throw err
        if (attempt < maxAttempts - 1) {
          const delay = baseDelayMs * Math.pow(2, attempt)
          await new Promise(r => setTimeout(r, delay))
        }
      }
    }
    throw lastErr
  }

  private async chatWithProvider(provider: LLMProvider, request: ChatRequest, isFallback = false): Promise<ChatResponse> {
    const timeoutMs = this.config.timeoutMs ?? 30000
    const maxRetries = this.config.maxRetries ?? 3
    const t0 = Date.now()

    const resp = await this.withRetry(
      () => this.withTimeout(timeoutMs, provider.chat(request)),
      maxRetries,
    )

    const latencyMs = Date.now() - t0
    console.log(
      `[gateway] ${provider.name} ok | model=${request.model} | latency=${latencyMs}ms` +
      ` | tokens=${resp.usage.total_tokens}${isFallback ? ' | fallback=true' : ''}`,
    )

    // Track stats
    this.stats.totalRequests++
    this.stats.totalTokens += resp.usage.total_tokens
    const cost = this.estimateCost(request.model, resp.usage.prompt_tokens, resp.usage.completion_tokens)
    this.stats.totalCostUsd += cost
    const ps = this.stats.byProvider[provider.name] ?? { requests: 0, tokens: 0, costUsd: 0 }
    ps.requests++; ps.tokens += resp.usage.total_tokens; ps.costUsd += cost
    this.stats.byProvider[provider.name] = ps
    return resp
  }

  private pickModel(candidates: string[]): string {
    for (const m of candidates) {
      const p = this.resolveProvider(m)
      if (p) return m
    }
    return candidates[0]
  }

  private get(name: string): LLMProvider {
    const p = this.providers.get(name)
    if (!p) throw new Error(`[gateway] Provider not configured: ${name}`)
    return p
  }

  private getDefault(): LLMProvider {
    const name = this.config.defaultProvider ?? [...this.providers.keys()][0]
    if (!name) throw new Error('[gateway] No providers configured')
    return this.providers.get(name)!
  }

  private createProvider(config: ProviderConfig): LLMProvider {
    switch (config.provider) {
      case 'anthropic': return new AnthropicProvider(config)
      case 'google':    return new GoogleProvider(config)
      case 'qwen':      return new QwenProvider(config)
      case 'ernie':     return new ErnieProvider(config)
      case 'hunyuan':   return new HunyuanProvider(config)
      case 'spark':     return new SparkProvider(config)
      case 'kimi':      return new KimiProvider(config)
      case 'zhipu':     return new ZhipuProvider(config)
      case 'baichuan':  return new BaichuanProvider(config)
      case 'ollama':    return new OllamaProvider(config)
      case 'openclaw':  return new OpenClawProvider(config)
      default:          return new OpenAICompatibleProvider(config)
    }
  }
}
