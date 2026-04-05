/**
 * @jackclaw/llm-gateway
 *
 * Universal LLM gateway — connect any AI model to your JackClaw nodes.
 *
 * Supported providers (out of the box):
 * - OpenAI (GPT-4o, GPT-4o-mini, o1, o3)
 * - Anthropic (Claude Opus, Sonnet, Haiku)
 * - Google (Gemini 2.0 Flash, 1.5 Pro)
 * - DeepSeek (deepseek-chat, deepseek-reasoner)
 * - Groq (Llama 3.3, Mixtral)
 * - Ollama (local: llama3, mistral, qwen2.5, any)
 * - OpenRouter (200+ models via one API)
 * - Any OpenAI-compatible endpoint
 *
 * @example
 * ```ts
 * import { createGateway } from '@jackclaw/llm-gateway'
 *
 * const gw = createGateway({
 *   openai:    { apiKey: process.env.OPENAI_API_KEY },
 *   anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
 *   google:    { apiKey: process.env.GOOGLE_API_KEY },
 *   deepseek:  { apiKey: process.env.DEEPSEEK_API_KEY },
 *   groq:      { apiKey: process.env.GROQ_API_KEY },
 *   ollama:    { baseUrl: 'http://localhost:11434' },
 * })
 *
 * // Auto-route: picks the right provider by model name
 * const reply = await gw.chat({ model: 'gpt-4o', messages: [...] })
 * const fast  = await gw.fast('Summarize this in 3 bullets: ...')
 * const smart = await gw.smart('Analyze this code: ...')
 * const free  = await gw.local('What is 2+2?', 'llama3')
 * ```
 */

export type {
  LLMProvider, ChatRequest, ChatResponse, ChatStreamDelta,
  ChatMessage, ChatChoice, TokenUsage, ToolCall, ToolDefinition,
  GatewayConfig, ProviderConfig, Role,
} from './types.js'

export { LLMGateway } from './gateway.js'
export type { GatewayStats } from './gateway.js'
export { OpenAICompatibleProvider } from './providers/openai-compatible.js'
export { AnthropicProvider } from './providers/anthropic.js'
export { GoogleProvider } from './providers/google.js'
// ── 国内模型 ──
export { QwenProvider }     from './providers/qwen.js'
export { ErnieProvider }    from './providers/ernie.js'
export { HunyuanProvider }  from './providers/hunyuan.js'
export { SparkProvider }    from './providers/spark.js'
export { KimiProvider }     from './providers/kimi.js'
export { ZhipuProvider }    from './providers/zhipu.js'
export { BaichuanProvider } from './providers/baichuan.js'
export { OllamaProvider }   from './providers/ollama.js'
export { OpenClawProvider, probeHealth } from './providers/openclaw.js'

// ─── Router, Config & Cost ───────────────────────────────────────────

export { ModelRouter } from './router.js'
export type { RouteRequest, ModelInfo } from './router.js'

export { CostTracker, costTracker } from './cost-tracker.js'
export type { UsageRecord, CostSummary } from './cost-tracker.js'

export {
  loadLLMConfig,
  saveLLMConfig,
  setLLMConfigValue,
  getLLMConfigValue,
} from './config.js'
export type { LLMConfig, LLMProviderEntry } from './config.js'

// ─── Quick factory ───────────────────────────────────────────────────

export interface QuickConfig {
  // ── 国际模型 ──
  openai?:      { apiKey: string; baseUrl?: string }
  anthropic?:   { apiKey: string; baseUrl?: string }
  google?:      { apiKey: string }
  deepseek?:    { apiKey: string }
  groq?:        { apiKey: string }
  mistral?:     { apiKey: string }
  together?:    { apiKey: string }
  openrouter?:  { apiKey: string }
  ollama?:      { baseUrl?: string; models?: string[] }
  // ── 国内模型 ──
  /** 通义千问 — 阿里云 */
  qwen?:        { apiKey: string; baseUrl?: string }
  /** 文心一言 — 百度 */
  ernie?:       { apiKey: string; baseUrl?: string }
  /** 混元 — 腾讯云 */
  hunyuan?:     { apiKey: string; baseUrl?: string }
  /** 讯飞星火 */
  spark?:       { apiKey: string; baseUrl?: string }
  /** Kimi — Moonshot AI */
  kimi?:        { apiKey: string; baseUrl?: string }
  /** GLM — 智谱 AI（glm-4-flash 免费！） */
  zhipu?:       { apiKey: string; baseUrl?: string }
  /** 百川 AI */
  baichuan?:    { apiKey: string; baseUrl?: string }
  /** 自定义 OpenAI-compatible 端点 */
  custom?:      { name: string; apiKey?: string; baseUrl: string; defaultModel?: string }
  /**
   * OpenClaw Gateway（本地聚合网关，默认 http://localhost:5337）
   * 设为 true 则使用默认配置；设为对象可自定义 baseUrl / apiKey。
   * 未配置时 createGateway 会自动探测本地是否运行 OpenClaw。
   */
  openclaw?:    true | { baseUrl?: string; apiKey?: string; defaultModel?: string }
  /** 默认 provider */
  defaultProvider?: string
  /** 故障转移链 */
  fallbackChain?: string[]
}

import { LLMGateway } from './gateway.js'
import type { GatewayConfig, ProviderConfig } from './types.js'
import { probeHealth } from './providers/openclaw.js'

export function createGateway(config: QuickConfig): LLMGateway {
  const providers: ProviderConfig[] = []

  if (config.openai) {
    providers.push({
      provider: 'openai',
      apiKey: config.openai.apiKey,
      baseUrl: config.openai.baseUrl ?? 'https://api.openai.com',
      defaultModel: 'gpt-4o',
    })
  }

  if (config.anthropic) {
    providers.push({
      provider: 'anthropic',
      apiKey: config.anthropic.apiKey,
      baseUrl: config.anthropic.baseUrl ?? 'https://api.anthropic.com',
      defaultModel: 'claude-sonnet-4-6',
    })
  }

  if (config.google) {
    providers.push({
      provider: 'google',
      apiKey: config.google.apiKey,
      defaultModel: 'gemini-2.0-flash',
    })
  }

  if (config.deepseek) {
    providers.push({
      provider: 'deepseek',
      apiKey: config.deepseek.apiKey,
      baseUrl: 'https://api.deepseek.com',
      defaultModel: 'deepseek-chat',
    })
  }

  if (config.groq) {
    providers.push({
      provider: 'groq',
      apiKey: config.groq.apiKey,
      baseUrl: 'https://api.groq.com/openai',
      defaultModel: 'llama-3.3-70b-versatile',
    })
  }

  if (config.mistral) {
    providers.push({
      provider: 'mistral',
      apiKey: config.mistral.apiKey,
      baseUrl: 'https://api.mistral.ai',
      defaultModel: 'mistral-large-latest',
    })
  }

  if (config.together) {
    providers.push({
      provider: 'together',
      apiKey: config.together.apiKey,
      baseUrl: 'https://api.together.xyz',
      defaultModel: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    })
  }

  if (config.openrouter) {
    providers.push({
      provider: 'openrouter',
      apiKey: config.openrouter.apiKey,
      baseUrl: 'https://openrouter.ai/api',
      defaultModel: 'openai/gpt-4o',
    })
  }

  if (config.ollama) {
    providers.push({
      provider: 'ollama',
      baseUrl: config.ollama.baseUrl ?? 'http://localhost:11434',
      defaultModel: config.ollama.models?.[0] ?? 'llama3',
      models: { ...(config.ollama.models?.reduce((a, m) => ({ ...a, [m]: m }), {})) },
    })
  }

  // ── 国内模型 ──
  if (config.qwen) {
    providers.push({
      provider: 'qwen',
      apiKey: config.qwen.apiKey,
      baseUrl: config.qwen.baseUrl ?? 'https://dashscope.aliyuncs.com/compatible-mode',
      defaultModel: 'qwen-max',
    })
  }

  if (config.ernie) {
    providers.push({
      provider: 'ernie',
      apiKey: config.ernie.apiKey,
      baseUrl: config.ernie.baseUrl ?? 'https://qianfan.baidubce.com/v2',
      defaultModel: 'ernie-4.5-turbo',
    })
  }

  if (config.hunyuan) {
    providers.push({
      provider: 'hunyuan',
      apiKey: config.hunyuan.apiKey,
      baseUrl: config.hunyuan.baseUrl ?? 'https://api.hunyuan.cloud.tencent.com/v1',
      defaultModel: 'hunyuan-pro',
    })
  }

  if (config.spark) {
    providers.push({
      provider: 'spark',
      apiKey: config.spark.apiKey,
      baseUrl: config.spark.baseUrl ?? 'https://spark-api-open.xf-yun.com/v1',
      defaultModel: 'generalv3.5',
    })
  }

  if (config.kimi) {
    providers.push({
      provider: 'kimi',
      apiKey: config.kimi.apiKey,
      baseUrl: config.kimi.baseUrl ?? 'https://api.moonshot.cn/v1',
      defaultModel: 'moonshot-v1-32k',
    })
  }

  if (config.zhipu) {
    providers.push({
      provider: 'zhipu',
      apiKey: config.zhipu.apiKey,
      baseUrl: config.zhipu.baseUrl ?? 'https://open.bigmodel.cn/api/paas/v4',
      defaultModel: 'glm-4-flash',
    })
  }

  if (config.baichuan) {
    providers.push({
      provider: 'baichuan',
      apiKey: config.baichuan.apiKey,
      baseUrl: config.baichuan.baseUrl ?? 'https://api.baichuan-ai.com/v1',
      defaultModel: 'Baichuan4',
    })
  }

  if (config.custom) {
    providers.push({
      provider: config.custom.name,
      apiKey: config.custom.apiKey,
      baseUrl: config.custom.baseUrl,
      defaultModel: config.custom.defaultModel,
    })
  }

  if (config.openclaw) {
    const oc = config.openclaw === true ? {} : config.openclaw
    providers.push({
      provider: 'openclaw',
      apiKey: oc.apiKey,
      baseUrl: oc.baseUrl ?? 'http://localhost:5337',
      defaultModel: oc.defaultModel ?? 'gpt-4o',
    })
  }

  if (!providers.length) {
    throw new Error('[createGateway] No providers configured. Pass at least one API key.')
  }

  const gwConfig: GatewayConfig = {
    providers,
    defaultProvider: config.defaultProvider ?? providers[0].provider,
    fallbackChain: config.fallbackChain,
  }

  return new LLMGateway(gwConfig)
}

/**
 * Async variant of createGateway with OpenClaw auto-detection.
 *
 * If `config.openclaw` is not set, probes `http://localhost:5337/health`.
 * When OpenClaw Gateway is detected, it is automatically added as a provider
 * and prepended to the fallback chain so JackClaw nodes can use it immediately.
 *
 * @example
 * const gw = await createGatewayAsync({
 *   anthropic: { apiKey: process.env.ANTHROPIC_API_KEY! },
 *   // openclaw auto-detected if running on :5337
 * })
 */
export async function createGatewayAsync(config: QuickConfig): Promise<LLMGateway> {
  let resolved = config

  if (!config.openclaw) {
    const running = await probeHealth('http://localhost:5337')
    if (running) {
      resolved = {
        ...config,
        openclaw: true,
        // Prepend openclaw to the fallback chain for zero-config priority
        fallbackChain: ['openclaw', ...(config.fallbackChain ?? [])],
      }
    }
  }

  return createGateway(resolved)
}
