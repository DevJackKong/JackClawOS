import fs from 'fs'
import path from 'path'
import os from 'os'

export interface LLMProviderConfig {
  apiKey?: string
  baseUrl?: string
  defaultModel?: string
  enabled: boolean
}

export interface JackClawConfig {
  nodeId?: string              // override auto-derived ID
  nodeName?: string            // display name for this node
  nodeRole?: string            // role: ceo, engineer, designer, etc.
  hubUrl: string               // e.g. http://localhost:3100
  callbackUrl?: string         // public URL the hub uses to reach this node (e.g. for Railway/NAT)
  port: number                 // HTTP server port (default 19000)
  reportCron: string           // cron expression (default: '0 8 * * *')
  workspaceDir: string         // OpenClaw workspace for memory files
  visibility: {
    shareMemory: boolean       // send memory summary to Hub
    shareTasks: boolean        // allow Hub to assign tasks
    redactPatterns: string[]   // regex patterns to redact from reports
  }
  ai: {
    baseUrl: string            // API endpoint（支持中转站）
    authToken: string          // Bearer token
    model: string              // 默认模型
    maxMemoryEntries: number   // 每次调用最多携带多少条 memory（SmartCache 压缩用）
    cacheProbeInterval: number // 缓存能力探测间隔（ms，默认24h）
  }
  /** Multi-model LLM providers (via @jackclaw/llm-gateway) */
  llm: {
    defaultProvider: string
    fallbackChain: string[]
    providers: {
      openai?:      LLMProviderConfig
      anthropic?:   LLMProviderConfig
      google?:      LLMProviderConfig
      deepseek?:    LLMProviderConfig
      groq?:        LLMProviderConfig
      mistral?:     LLMProviderConfig
      together?:    LLMProviderConfig
      openrouter?:  LLMProviderConfig
      ollama?:      LLMProviderConfig & { baseUrl: string }
      // ── 国内模型 ──
      qwen?:        LLMProviderConfig  // 通义千问
      ernie?:       LLMProviderConfig  // 文心一言
      hunyuan?:     LLMProviderConfig  // 混元
      spark?:       LLMProviderConfig  // 讯飞星火
      kimi?:        LLMProviderConfig  // Kimi (Moonshot)
      zhipu?:       LLMProviderConfig  // 智谱 GLM
      baichuan?:    LLMProviderConfig  // 百川
      [key: string]: LLMProviderConfig | undefined
    }
  }
}

const CONFIG_DIR = path.join(os.homedir(), '.jackclaw')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

const DEFAULTS: JackClawConfig = {
  hubUrl: 'http://localhost:3100',
  callbackUrl: undefined,
  port: 19000,
  reportCron: '0 8 * * *',
  workspaceDir: path.join(os.homedir(), '.openclaw', 'workspace'),
  visibility: {
    shareMemory: true,
    shareTasks: true,
    redactPatterns: [],
  },
  ai: {
    baseUrl: process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com',
    authToken: process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY ?? '',
    model: 'claude-sonnet-4-6',
    maxMemoryEntries: 20,
    cacheProbeInterval: 24 * 60 * 60 * 1000,
  },
  llm: {
    defaultProvider: 'anthropic',
    fallbackChain: ['openai', 'deepseek', 'groq', 'ollama'],
    providers: {
      anthropic: {
        enabled: true,
        apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN ?? '',
        baseUrl: process.env.ANTHROPIC_BASE_URL,
        defaultModel: 'claude-sonnet-4-6',
      },
      openai: {
        enabled: !!process.env.OPENAI_API_KEY,
        apiKey: process.env.OPENAI_API_KEY ?? '',
        defaultModel: 'gpt-4o-mini',
      },
      google: {
        enabled: !!process.env.GOOGLE_API_KEY,
        apiKey: process.env.GOOGLE_API_KEY ?? '',
        defaultModel: 'gemini-2.0-flash',
      },
      deepseek: {
        enabled: !!process.env.DEEPSEEK_API_KEY,
        apiKey: process.env.DEEPSEEK_API_KEY ?? '',
        defaultModel: 'deepseek-chat',
      },
      groq: {
        enabled: !!process.env.GROQ_API_KEY,
        apiKey: process.env.GROQ_API_KEY ?? '',
        defaultModel: 'llama-3.3-70b-versatile',
      },
      ollama: {
        enabled: false,
        apiKey: '',
        baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
        defaultModel: 'llama3',
      },
      // ── 国内模型 ──
      qwen: {
        enabled: !!process.env.QWEN_API_KEY,
        apiKey: process.env.QWEN_API_KEY ?? '',
        defaultModel: 'qwen-plus',
      },
      ernie: {
        enabled: !!process.env.ERNIE_API_KEY,
        apiKey: process.env.ERNIE_API_KEY ?? '',
        defaultModel: 'ernie-4.5-turbo',
      },
      hunyuan: {
        enabled: !!process.env.HUNYUAN_API_KEY,
        apiKey: process.env.HUNYUAN_API_KEY ?? '',
        defaultModel: 'hunyuan-turbo',
      },
      spark: {
        enabled: !!process.env.SPARK_API_KEY,
        apiKey: process.env.SPARK_API_KEY ?? '',
        defaultModel: 'generalv3.5',
      },
      kimi: {
        enabled: !!process.env.KIMI_API_KEY,
        apiKey: process.env.KIMI_API_KEY ?? '',
        defaultModel: 'moonshot-v1-32k',
      },
      zhipu: {
        enabled: !!process.env.ZHIPU_API_KEY,
        apiKey: process.env.ZHIPU_API_KEY ?? '',
        defaultModel: 'glm-4-flash',
      },
      baichuan: {
        enabled: !!process.env.BAICHUAN_API_KEY,
        apiKey: process.env.BAICHUAN_API_KEY ?? '',
        defaultModel: 'Baichuan4',
      },
    },
  },
}

export function loadConfig(): JackClawConfig {
  let base: JackClawConfig

  if (!fs.existsSync(CONFIG_FILE)) {
    // Write defaults so user can edit
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULTS, null, 2))
    console.log(`[config] Created default config at: ${CONFIG_FILE}`)
    base = { ...DEFAULTS }
  } else {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8')
    const user = JSON.parse(raw) as Partial<JackClawConfig>
    base = {
      ...DEFAULTS,
      ...user,
      visibility: {
        ...DEFAULTS.visibility,
        ...(user.visibility ?? {}),
      },
      ai: {
        ...DEFAULTS.ai,
        ...(user.ai ?? {}),
      },
      llm: {
        ...DEFAULTS.llm,
        ...(user.llm ?? {}),
        providers: {
          ...DEFAULTS.llm.providers,
          ...(user.llm?.providers ?? {}),
        },
      },
    }
  }

  // Allow env var overrides for testing / containerized deployments
  if (process.env['NODE_PORT']) base.port = parseInt(process.env['NODE_PORT'], 10)
  if (process.env['PORT'])      base.port = parseInt(process.env['PORT'], 10)  // Railway injects PORT — takes highest priority
  if (process.env['JACKCLAW_HUB_URL']) base.hubUrl = process.env['JACKCLAW_HUB_URL']
  if (process.env['JACKCLAW_NODE_ID']) base.nodeId = process.env['JACKCLAW_NODE_ID']
  if (process.env['JACKCLAW_CALLBACK_URL']) base.callbackUrl = process.env['JACKCLAW_CALLBACK_URL']

  return base
}
