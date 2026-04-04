/**
 * JackClaw Declarative Configuration — jackclaw.yaml
 *
 * Zero-code setup: define handle, hub, role, capabilities in one file.
 * Inspired by CrewAI's simple YAML-first approach.
 *
 * Example jackclaw.yaml:
 * ```yaml
 * handle: "@alice"
 * hub: "hub.jackclaw.ai"
 * role: member
 * displayName: "Alice's Agent"
 * capabilities:
 *   - chat
 *   - task-execution
 *   - code-review
 * visibility: public
 * autoConnect: true
 * ```
 */

import fs from 'fs'
import path from 'path'
import os from 'os'

export interface JackClawConfig {
  /** Agent handle (e.g., "@alice") */
  handle: string
  /** Hub URL to connect to */
  hub: string
  /** Agent role */
  role: 'ceo' | 'executive' | 'member' | 'guest' | 'bot'
  /** Display name */
  displayName: string
  /** List of capabilities */
  capabilities: string[]
  /** Visibility: public | contacts | org | private */
  visibility: 'public' | 'contacts' | 'org' | 'private'
  /** Auto-connect to hub on start */
  autoConnect: boolean
  /** Port for local Node server */
  port?: number
  /** LLM provider configuration */
  llm?: {
    provider: string
    model: string
    apiKey?: string
  }
}

const DEFAULT_CONFIG: JackClawConfig = {
  handle: '',
  hub: 'https://hub.jackclaw.ai',
  role: 'member',
  displayName: '',
  capabilities: ['chat'],
  visibility: 'public',
  autoConnect: true,
  port: 19000,
}

/** Search order for config file */
const CONFIG_SEARCH_PATHS = [
  'jackclaw.yaml',
  'jackclaw.yml',
  '.jackclaw.yaml',
  path.join(os.homedir(), '.jackclaw', 'config.yaml'),
]

/**
 * Parse YAML-like config (simplified, no dependency on yaml package)
 * Supports: key: value, lists with "- item"
 */
function parseSimpleYaml(content: string): Record<string, any> {
  const result: Record<string, any> = {}
  let currentKey = ''
  let currentList: string[] | null = null

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trimEnd()
    if (!line || line.startsWith('#')) continue

    // List item
    if (line.match(/^\s+-\s+/)) {
      const value = line.replace(/^\s+-\s+/, '').trim()
      if (currentList) {
        currentList.push(value.replace(/^["']|["']$/g, ''))
      }
      continue
    }

    // Key: value
    const match = line.match(/^(\w+):\s*(.*)$/)
    if (match) {
      // Save previous list
      if (currentList && currentKey) {
        result[currentKey] = currentList
        currentList = null
      }

      const [, key, rawVal] = match
      const val = rawVal.trim()

      if (!val) {
        // Empty value = start of list or nested object
        currentKey = key
        currentList = []
      } else {
        currentKey = key
        // Parse value
        if (val === 'true') result[key] = true
        else if (val === 'false') result[key] = false
        else if (/^\d+$/.test(val)) result[key] = parseInt(val, 10)
        else result[key] = val.replace(/^["']|["']$/g, '')
      }
    }
  }

  // Save last list
  if (currentList && currentKey) {
    result[currentKey] = currentList
  }

  return result
}

/** Load config from jackclaw.yaml */
export function loadConfig(explicitPath?: string): JackClawConfig {
  const paths = explicitPath ? [explicitPath] : CONFIG_SEARCH_PATHS

  for (const p of paths) {
    const resolved = path.resolve(p)
    if (fs.existsSync(resolved)) {
      const content = fs.readFileSync(resolved, 'utf-8')
      const parsed = parseSimpleYaml(content)
      console.log(`[config] Loaded from ${resolved}`)
      return { ...DEFAULT_CONFIG, ...parsed } as JackClawConfig
    }
  }

  // No config file found — return defaults
  return { ...DEFAULT_CONFIG }
}

/** Generate a starter jackclaw.yaml */
export function generateConfig(handle: string, hub?: string): string {
  return `# JackClaw Configuration
# Generated automatically — customize as needed

handle: "${handle}"
hub: "${hub || 'https://hub.jackclaw.ai'}"
role: member
displayName: "${handle.replace('@', '')}'s Agent"
capabilities:
  - chat
  - task-execution
visibility: public
autoConnect: true
port: 19000
`
}

/** Save config to file */
export function saveConfig(config: string, filePath = 'jackclaw.yaml'): void {
  fs.writeFileSync(filePath, config, 'utf-8')
  console.log(`[config] Saved to ${filePath}`)
}
