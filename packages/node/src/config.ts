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
}

export function loadConfig(): JackClawConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    // Write defaults so user can edit
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULTS, null, 2))
    console.log(`[config] Created default config at: ${CONFIG_FILE}`)
    return { ...DEFAULTS }
  }

  const raw = fs.readFileSync(CONFIG_FILE, 'utf8')
  const user = JSON.parse(raw) as Partial<JackClawConfig>
  return {
    ...DEFAULTS,
    ...user,
    visibility: {
      ...DEFAULTS.visibility,
      ...(user.visibility ?? {}),
    },
  }
}
