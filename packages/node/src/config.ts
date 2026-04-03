import fs from 'fs'
import path from 'path'
import os from 'os'

export interface JackClawConfig {
  nodeId?: string              // override auto-derived ID
  hubUrl: string               // e.g. http://localhost:18999
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
}

const CONFIG_DIR = path.join(os.homedir(), '.jackclaw')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

const DEFAULTS: JackClawConfig = {
  hubUrl: 'http://localhost:18999',
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
    }
  }

  // Allow env var overrides for testing / containerized deployments
  if (process.env['NODE_PORT']) base.port = parseInt(process.env['NODE_PORT'], 10)
  if (process.env['JACKCLAW_HUB_URL']) base.hubUrl = process.env['JACKCLAW_HUB_URL']
  if (process.env['JACKCLAW_NODE_ID']) base.nodeId = process.env['JACKCLAW_NODE_ID']

  return base
}
