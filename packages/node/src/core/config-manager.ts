import fs from 'fs'
import os from 'os'
import path from 'path'

export type Environment = 'development' | 'staging' | 'production'

export interface JackClawConfig {
  env: Environment
  dataDir: string
  logLevel: 'debug' | 'info' | 'warn' | 'error'

  memory: {
    maxEntries: number
    compactionIntervalMs: number
    staleThresholdDays: number
  }

  router: {
    defaultTimeoutMs: number
    maxRetries: number
    healthCheckIntervalMs: number
  }

  skills: {
    autoEvolutionEnabled: boolean
    evolutionThreshold: number
    autoApproveThreshold: number
  }

  api: {
    enabled: boolean
    port: number
    rateLimitRpm: number
  }

  optimizer: {
    enabled: boolean
    scheduleIntervalMs: number
    autoApplyPatches: boolean
  }
}

type PlainObject = Record<string, unknown>

const CONFIG_DIR = path.join(os.homedir(), '.jackclaw')
const DEFAULT_CONFIG_PATH = path.join(CONFIG_DIR, 'runtime-config.json')

const DEFAULT_CONFIG: JackClawConfig = {
  env: 'development',
  dataDir: path.join(os.homedir(), '.jackclaw', 'data'),
  logLevel: 'info',
  memory: {
    maxEntries: 1000,
    compactionIntervalMs: 60 * 60 * 1000,
    staleThresholdDays: 30,
  },
  router: {
    defaultTimeoutMs: 30_000,
    maxRetries: 3,
    healthCheckIntervalMs: 60_000,
  },
  skills: {
    autoEvolutionEnabled: false,
    evolutionThreshold: 0.8,
    autoApproveThreshold: 0.95,
  },
  api: {
    enabled: true,
    port: 19000,
    rateLimitRpm: 120,
  },
  optimizer: {
    enabled: false,
    scheduleIntervalMs: 24 * 60 * 60 * 1000,
    autoApplyPatches: false,
  },
}

export class ConfigManager {
  private static currentConfig: JackClawConfig | null = null
  private static currentConfigPath = DEFAULT_CONFIG_PATH

  static load(configPath?: string): JackClawConfig {
    const resolvedPath = configPath ?? this.currentConfigPath ?? DEFAULT_CONFIG_PATH
    this.currentConfigPath = resolvedPath

    let fileConfig: Partial<JackClawConfig> = {}

    if (fs.existsSync(resolvedPath)) {
      const raw = fs.readFileSync(resolvedPath, 'utf8').trim()
      if (raw) {
        fileConfig = JSON.parse(raw) as Partial<JackClawConfig>
      }
    } else if (!configPath) {
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true })
      fs.writeFileSync(resolvedPath, JSON.stringify(DEFAULT_CONFIG, null, 2))
    }

    const envConfig = this.fromEnv()
    const merged = this.deepMerge(DEFAULT_CONFIG, fileConfig, envConfig) as JackClawConfig
    const validation = this.validate(merged)

    if (!validation.valid) {
      throw new Error(`Invalid JackClaw config: ${validation.errors.join('; ')}`)
    }

    this.currentConfig = merged
    return this.cloneConfig(merged)
  }

  static get(): JackClawConfig {
    if (!this.currentConfig) {
      return this.load()
    }

    return this.cloneConfig(this.currentConfig)
  }

  static set(configPath: string, value: unknown): void {
    const config = this.get()
    this.assignPath(config as unknown as PlainObject, configPath, value)

    const validation = this.validate(config)
    if (!validation.valid) {
      throw new Error(`Invalid JackClaw config update: ${validation.errors.join('; ')}`)
    }

    this.currentConfig = config
  }

  static validate(config: Partial<JackClawConfig>): { valid: boolean; errors: string[] } {
    const errors: string[] = []
    const candidate = config as JackClawConfig

    const envs: Environment[] = ['development', 'staging', 'production']
    const logLevels: JackClawConfig['logLevel'][] = ['debug', 'info', 'warn', 'error']

    if (candidate.env !== undefined && !envs.includes(candidate.env)) {
      errors.push('env must be one of development, staging, production')
    }

    if (candidate.dataDir !== undefined && (!this.isNonEmptyString(candidate.dataDir) || !path.isAbsolute(candidate.dataDir))) {
      errors.push('dataDir must be a non-empty absolute path')
    }

    if (candidate.logLevel !== undefined && !logLevels.includes(candidate.logLevel)) {
      errors.push('logLevel must be one of debug, info, warn, error')
    }

    if (candidate.memory) {
      this.validatePositiveInteger(candidate.memory.maxEntries, 'memory.maxEntries', errors, 1)
      this.validatePositiveInteger(candidate.memory.compactionIntervalMs, 'memory.compactionIntervalMs', errors, 1)
      this.validatePositiveInteger(candidate.memory.staleThresholdDays, 'memory.staleThresholdDays', errors, 1)
    }

    if (candidate.router) {
      this.validatePositiveInteger(candidate.router.defaultTimeoutMs, 'router.defaultTimeoutMs', errors, 1)
      this.validatePositiveInteger(candidate.router.maxRetries, 'router.maxRetries', errors, 0)
      this.validatePositiveInteger(candidate.router.healthCheckIntervalMs, 'router.healthCheckIntervalMs', errors, 1)
    }

    if (candidate.skills) {
      this.validateBoolean(candidate.skills.autoEvolutionEnabled, 'skills.autoEvolutionEnabled', errors)
      this.validateNumberInRange(candidate.skills.evolutionThreshold, 'skills.evolutionThreshold', errors, 0, 1)
      this.validateNumberInRange(candidate.skills.autoApproveThreshold, 'skills.autoApproveThreshold', errors, 0, 1)
      if (
        typeof candidate.skills.evolutionThreshold === 'number' &&
        typeof candidate.skills.autoApproveThreshold === 'number' &&
        candidate.skills.autoApproveThreshold < candidate.skills.evolutionThreshold
      ) {
        errors.push('skills.autoApproveThreshold must be >= skills.evolutionThreshold')
      }
    }

    if (candidate.api) {
      this.validateBoolean(candidate.api.enabled, 'api.enabled', errors)
      this.validatePositiveInteger(candidate.api.port, 'api.port', errors, 1, 65535)
      this.validatePositiveInteger(candidate.api.rateLimitRpm, 'api.rateLimitRpm', errors, 1)
    }

    if (candidate.optimizer) {
      this.validateBoolean(candidate.optimizer.enabled, 'optimizer.enabled', errors)
      this.validatePositiveInteger(candidate.optimizer.scheduleIntervalMs, 'optimizer.scheduleIntervalMs', errors, 1)
      this.validateBoolean(candidate.optimizer.autoApplyPatches, 'optimizer.autoApplyPatches', errors)
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }

  static export(): string {
    const config = this.get()
    const exported: JackClawConfig = {
      ...config,
      dataDir: this.sanitizePath(config.dataDir),
    }

    return JSON.stringify(exported, null, 2)
  }

  private static fromEnv(): Partial<JackClawConfig> {
    const envConfig: Partial<JackClawConfig> = {}

    if (process.env.JACKCLAW_ENV) {
      envConfig.env = process.env.JACKCLAW_ENV as Environment
    }

    if (process.env.JACKCLAW_DATA_DIR) {
      envConfig.dataDir = process.env.JACKCLAW_DATA_DIR
    }

    if (process.env.JACKCLAW_LOG_LEVEL) {
      envConfig.logLevel = process.env.JACKCLAW_LOG_LEVEL as JackClawConfig['logLevel']
    }

    if (process.env.JACKCLAW_PORT) {
      envConfig.api = {
        ...(envConfig.api ?? {}),
        port: Number.parseInt(process.env.JACKCLAW_PORT, 10),
      } as JackClawConfig['api']
    }

    return envConfig
  }

  private static deepMerge<T>(...sources: unknown[]): T {
    const result: PlainObject = {}

    for (const source of sources) {
      if (!this.isPlainObject(source)) continue

      for (const [key, value] of Object.entries(source)) {
        const existing = result[key]

        if (this.isPlainObject(existing) && this.isPlainObject(value)) {
          result[key] = this.deepMerge(existing, value)
        } else if (Array.isArray(value)) {
          result[key] = [...value]
        } else {
          result[key] = value
        }
      }
    }

    return result as T
  }

  private static assignPath(target: PlainObject, configPath: string, value: unknown): void {
    const segments = configPath.split('.').filter(Boolean)
    if (segments.length === 0) {
      throw new Error('Config path cannot be empty')
    }

    let cursor: PlainObject = target
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i]
      const next = cursor[segment]

      if (!this.isPlainObject(next)) {
        cursor[segment] = {}
      }

      cursor = cursor[segment] as PlainObject
    }

    cursor[segments[segments.length - 1]] = value
  }

  private static cloneConfig(config: JackClawConfig): JackClawConfig {
    return JSON.parse(JSON.stringify(config)) as JackClawConfig
  }

  private static sanitizePath(value: string): string {
    const home = os.homedir()
    return value.startsWith(home) ? value.replace(home, '~') : value
  }

  private static isPlainObject(value: unknown): value is PlainObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  private static isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0
  }

  private static validatePositiveInteger(
    value: unknown,
    field: string,
    errors: string[],
    min: number,
    max?: number,
  ): void {
    if (value === undefined) return
    if (!Number.isInteger(value) || (value as number) < min || (max !== undefined && (value as number) > max)) {
      errors.push(`${field} must be an integer between ${min} and ${max ?? '∞'}`)
    }
  }

  private static validateNumberInRange(
    value: unknown,
    field: string,
    errors: string[],
    min: number,
    max: number,
  ): void {
    if (value === undefined) return
    if (typeof value !== 'number' || Number.isNaN(value) || value < min || value > max) {
      errors.push(`${field} must be a number between ${min} and ${max}`)
    }
  }

  private static validateBoolean(value: unknown, field: string, errors: string[]): void {
    if (value === undefined) return
    if (typeof value !== 'boolean') {
      errors.push(`${field} must be a boolean`)
    }
  }
}
