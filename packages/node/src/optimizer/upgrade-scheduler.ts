import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { SelfUpgradeSystem } from './self-upgrade'

type TaskLog = {
  taskType: string
  success: boolean
  retryCount: number
  latencyMs: number
}

type MemoryHit = {
  memoryId: string
  hitCount: number
  successRate: number
  lastUsed: number
}

export interface SchedulerConfig {
  intervalMs: number
  dataDir: string
  reportOutputDir: string
  enabled: boolean
}

const DEFAULT_CONFIG: SchedulerConfig = {
  intervalMs: 24 * 60 * 60 * 1000,
  dataDir: './data',
  reportOutputDir: './reports',
  enabled: true,
}

const SUPPORTED_EXTENSIONS = new Set(['.json', '.jsonl', '.log', '.txt', '.md'])

export class UpgradeScheduler {
  private readonly config: SchedulerConfig
  private timer?: NodeJS.Timeout
  private running = false
  private lastRun?: number
  private nextRun?: number
  private cycleCount = 0
  private inFlightRun?: Promise<string>

  constructor(config: Partial<SchedulerConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    }

    if (this.config.enabled) {
      this.nextRun = Date.now() + this.config.intervalMs
    }
  }

  start(): void {
    if (this.running || !this.config.enabled) {
      return
    }

    this.running = true
    this.nextRun = Date.now() + this.config.intervalMs
    this.timer = setInterval(() => {
      void this.runScheduledCycle()
    }, this.config.intervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }

    this.running = false
    this.nextRun = undefined
  }

  async runNow(): Promise<string> {
    if (this.inFlightRun) {
      return this.inFlightRun
    }

    this.inFlightRun = (async () => {
      const upgrader = new SelfUpgradeSystem({
        reportOutputPath: join(
          resolve(this.config.reportOutputDir),
          `self-upgrade-${this.formatTimestamp(Date.now())}.md`,
        ),
      })

      const result = await upgrader.runCycle({
        taskLogs: this.loadRecentTaskLogs(),
        memoryHits: this.loadMemoryHits(),
      })

      this.lastRun = Date.now()
      this.cycleCount += 1
      this.nextRun = this.running ? this.lastRun + this.config.intervalMs : undefined

      return result.recommendations.length > 0
        ? `${upgrader.getSummary()} | top=${result.recommendations[0]}`
        : upgrader.getSummary()
    })()

    try {
      return await this.inFlightRun
    } finally {
      this.inFlightRun = undefined
    }
  }

  getStatus(): { running: boolean; lastRun?: number; nextRun?: number; cycleCount: number } {
    return {
      running: this.running,
      lastRun: this.lastRun,
      nextRun: this.nextRun,
      cycleCount: this.cycleCount,
    }
  }

  private async runScheduledCycle(): Promise<void> {
    if (!this.running || this.inFlightRun) {
      return
    }

    try {
      await this.runNow()
    } catch {
      const now = Date.now()
      this.lastRun = now
      this.cycleCount += 1
      this.nextRun = this.running ? now + this.config.intervalMs : undefined
    }
  }

  private loadRecentTaskLogs(): any[] {
    const entries = this.readDataFiles()
    const taskLogs: TaskLog[] = []

    for (const entry of entries) {
      for (const item of this.parseStructuredContent(entry.content)) {
        const taskLog = this.toTaskLog(item)
        if (taskLog) {
          taskLogs.push(taskLog)
        }
      }

      for (const line of entry.content.split(/\r?\n/)) {
        const taskLog = this.parseTaskLogLine(line)
        if (taskLog) {
          taskLogs.push(taskLog)
        }
      }
    }

    return taskLogs.slice(-500)
  }

  private loadMemoryHits(): any[] {
    const entries = this.readDataFiles()
    const memoryHits: MemoryHit[] = []

    for (const entry of entries) {
      for (const item of this.parseStructuredContent(entry.content)) {
        const memoryHit = this.toMemoryHit(item)
        if (memoryHit) {
          memoryHits.push(memoryHit)
        }
      }

      for (const line of entry.content.split(/\r?\n/)) {
        const memoryHit = this.parseMemoryHitLine(line)
        if (memoryHit) {
          memoryHits.push(memoryHit)
        }
      }
    }

    return memoryHits.slice(-500)
  }

  private readDataFiles(): Array<{ path: string; content: string; mtimeMs: number }> {
    const dataDir = resolve(this.config.dataDir)
    if (!existsSync(dataDir)) {
      return []
    }

    const files = readdirSync(dataDir)
      .map((name) => join(dataDir, name))
      .filter((filePath) => {
        try {
          const stat = statSync(filePath)
          return stat.isFile() && SUPPORTED_EXTENSIONS.has(this.getExtension(filePath))
        } catch {
          return false
        }
      })
      .map((filePath) => ({
        path: filePath,
        mtimeMs: statSync(filePath).mtimeMs,
      }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, 20)

    return files.map((file) => ({
      path: file.path,
      mtimeMs: file.mtimeMs,
      content: readFileSync(file.path, 'utf8'),
    }))
  }

  private parseStructuredContent(content: string): unknown[] {
    const trimmed = content.trim()
    if (!trimmed) {
      return []
    }

    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) {
          return parsed
        }
        if (parsed && typeof parsed === 'object') {
          const container = parsed as Record<string, unknown>
          for (const key of ['taskLogs', 'memoryHits', 'logs', 'items', 'data']) {
            if (Array.isArray(container[key])) {
              return container[key] as unknown[]
            }
          }
          return [parsed]
        }
      } catch {
        // ignore and continue with line parsing
      }
    }

    const jsonlItems: unknown[] = []
    for (const line of trimmed.split(/\r?\n/)) {
      const candidate = line.trim()
      if (!candidate || (!candidate.startsWith('{') && !candidate.startsWith('['))) {
        continue
      }
      try {
        jsonlItems.push(JSON.parse(candidate))
      } catch {
        return []
      }
    }

    return jsonlItems
  }

  private parseTaskLogLine(line: string): TaskLog | undefined {
    const normalized = line.trim()
    if (!normalized) {
      return undefined
    }

    const taskTypeMatch = normalized.match(/task(?:Type)?[=:]\s*([^|,;]+)/i)
    const latencyMatch = normalized.match(/latency(?:Ms)?[=:]\s*(\d+)/i)
    const retryMatch = normalized.match(/retry(?:Count)?[=:]\s*(\d+)/i)
    const success = /\b(success|completed|done|passed|✅)\b/i.test(normalized)
    const failed = /\b(fail|failed|error|timeout|❌)\b/i.test(normalized)

    if (!taskTypeMatch || (!success && !failed)) {
      return undefined
    }

    return {
      taskType: taskTypeMatch[1].trim(),
      success: success && !failed,
      retryCount: retryMatch ? Number(retryMatch[1]) : 0,
      latencyMs: latencyMatch ? Number(latencyMatch[1]) : 0,
    }
  }

  private parseMemoryHitLine(line: string): MemoryHit | undefined {
    const normalized = line.trim()
    if (!normalized) {
      return undefined
    }

    const memoryIdMatch = normalized.match(/memory(?:Id)?[=:]\s*([^|,;]+)/i)
    const hitCountMatch = normalized.match(/hitCount[=:]\s*(\d+)/i)
    const successRateMatch = normalized.match(/successRate[=:]\s*(\d+(?:\.\d+)?)/i)
    const lastUsedMatch = normalized.match(/lastUsed[=:]\s*(\d+)/i)

    if (!memoryIdMatch) {
      return undefined
    }

    return {
      memoryId: memoryIdMatch[1].trim(),
      hitCount: hitCountMatch ? Number(hitCountMatch[1]) : 0,
      successRate: this.normalizeRate(successRateMatch ? Number(successRateMatch[1]) : 0),
      lastUsed: lastUsedMatch ? Number(lastUsedMatch[1]) : Date.now(),
    }
  }

  private toTaskLog(value: unknown): TaskLog | undefined {
    if (!value || typeof value !== 'object') {
      return undefined
    }

    const item = value as Record<string, unknown>
    const taskType = this.readString(item.taskType) ?? this.readString(item.type) ?? this.readString(item.task)
    const success = this.readBoolean(item.success) ?? this.readBoolean(item.ok) ?? this.readBoolean(item.completed)

    if (!taskType || success === undefined) {
      return undefined
    }

    return {
      taskType,
      success,
      retryCount: this.readNumber(item.retryCount) ?? this.readNumber(item.retries) ?? 0,
      latencyMs: this.readNumber(item.latencyMs) ?? this.readNumber(item.durationMs) ?? 0,
    }
  }

  private toMemoryHit(value: unknown): MemoryHit | undefined {
    if (!value || typeof value !== 'object') {
      return undefined
    }

    const item = value as Record<string, unknown>
    const memoryId = this.readString(item.memoryId) ?? this.readString(item.id)
    if (!memoryId) {
      return undefined
    }

    return {
      memoryId,
      hitCount: this.readNumber(item.hitCount) ?? this.readNumber(item.hits) ?? 0,
      successRate: this.normalizeRate(this.readNumber(item.successRate) ?? this.readNumber(item.rate) ?? 0),
      lastUsed: this.readNumber(item.lastUsed) ?? this.readNumber(item.updatedAt) ?? Date.now(),
    }
  }

  private normalizeRate(value: number): number {
    if (value > 1) {
      return Number((value / 100).toFixed(4))
    }
    if (value < 0) {
      return 0
    }
    return value
  }

  private readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }

  private readNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) {
        return parsed
      }
    }
    return undefined
  }

  private readBoolean(value: unknown): boolean | undefined {
    if (typeof value === 'boolean') {
      return value
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase()
      if (['true', '1', 'yes', 'y', 'success', 'ok'].includes(normalized)) {
        return true
      }
      if (['false', '0', 'no', 'n', 'fail', 'failed', 'error'].includes(normalized)) {
        return false
      }
    }
    return undefined
  }

  private getExtension(filePath: string): string {
    const index = filePath.lastIndexOf('.')
    return index >= 0 ? filePath.slice(index).toLowerCase() : ''
  }

  private formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp)
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  }
}
