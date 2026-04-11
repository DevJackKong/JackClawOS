import { existsSync, readFileSync, writeFileSync } from 'node:fs'

export interface FrequencyRecord {
  taskType: string
  successCount: number
  totalCount: number
  avgLatencyMs: number
  lastSeenAt: number
  firstSeenAt: number
}

export interface SkillCandidate {
  taskType: string
  reason: string
  confidence: number
  suggestedSkillName: string
  suggestedTriggers: string[]
  templateHint: string
}

interface TaskStats extends FrequencyRecord {
  consecutiveSuccessCount: number
  latencyTotalMs: number
}

interface PersistedState {
  records: TaskStats[]
  skillized: string[]
}

const MIN_CONSECUTIVE_SUCCESSES = 3
const MIN_SUCCESS_RATE = 0.8
const MIN_TOTAL_COUNT = 5

export class SkillEvolutionDetector {
  private records = new Map<string, TaskStats>()
  private skillized = new Set<string>()

  record(taskType: string, success: boolean, latencyMs: number): void {
    const now = Date.now()
    const safeLatency = Number.isFinite(latencyMs) && latencyMs >= 0 ? latencyMs : 0
    const existing = this.records.get(taskType)

    if (!existing) {
      this.records.set(taskType, {
        taskType,
        successCount: success ? 1 : 0,
        totalCount: 1,
        avgLatencyMs: safeLatency,
        latencyTotalMs: safeLatency,
        firstSeenAt: now,
        lastSeenAt: now,
        consecutiveSuccessCount: success ? 1 : 0,
      })
      return
    }

    existing.totalCount += 1
    existing.lastSeenAt = now
    existing.latencyTotalMs += safeLatency
    existing.avgLatencyMs = existing.latencyTotalMs / existing.totalCount

    if (success) {
      existing.successCount += 1
      existing.consecutiveSuccessCount += 1
    } else {
      existing.consecutiveSuccessCount = 0
    }
  }

  detect(): SkillCandidate[] {
    return this.getSortedStats()
      .filter((record) => !this.skillized.has(record.taskType))
      .filter((record) => this.isSkillCandidate(record))
      .map((record) => this.toSkillCandidate(record))
  }

  getFrequencies(): FrequencyRecord[] {
    return this.getSortedStats().map((record) => ({
      taskType: record.taskType,
      successCount: record.successCount,
      totalCount: record.totalCount,
      avgLatencyMs: record.avgLatencyMs,
      lastSeenAt: record.lastSeenAt,
      firstSeenAt: record.firstSeenAt,
    }))
  }

  markSkillized(taskType: string): void {
    this.skillized.add(taskType)
  }

  save(filePath: string): void {
    const payload: PersistedState = {
      records: Array.from(this.records.values()),
      skillized: Array.from(this.skillized.values()),
    }

    writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8')
  }

  load(filePath: string): void {
    if (!existsSync(filePath)) {
      return
    }

    const raw = readFileSync(filePath, 'utf8').trim()
    if (!raw) {
      return
    }

    const parsed = JSON.parse(raw) as Partial<PersistedState>
    const nextRecords = new Map<string, TaskStats>()

    for (const item of parsed.records ?? []) {
      if (!item?.taskType) {
        continue
      }

      const totalCount = this.toNonNegativeInteger(item.totalCount)
      const successCount = Math.min(this.toNonNegativeInteger(item.successCount), totalCount)
      const avgLatencyMs = this.toNonNegativeNumber(item.avgLatencyMs)
      const latencyTotalMs = this.toNonNegativeNumber(item.latencyTotalMs ?? avgLatencyMs * totalCount)

      nextRecords.set(item.taskType, {
        taskType: item.taskType,
        successCount,
        totalCount,
        avgLatencyMs: totalCount > 0 ? latencyTotalMs / totalCount : avgLatencyMs,
        latencyTotalMs,
        firstSeenAt: this.toTimestamp(item.firstSeenAt),
        lastSeenAt: this.toTimestamp(item.lastSeenAt),
        consecutiveSuccessCount: this.toNonNegativeInteger(item.consecutiveSuccessCount),
      })
    }

    this.records = nextRecords
    this.skillized = new Set((parsed.skillized ?? []).filter((value): value is string => typeof value === 'string' && value.length > 0))
  }

  private isSkillCandidate(record: TaskStats): boolean {
    return (
      record.consecutiveSuccessCount >= MIN_CONSECUTIVE_SUCCESSES &&
      record.totalCount >= MIN_TOTAL_COUNT &&
      this.getSuccessRate(record) >= MIN_SUCCESS_RATE
    )
  }

  private toSkillCandidate(record: TaskStats): SkillCandidate {
    const successRate = this.getSuccessRate(record)
    const confidence = this.toConfidence(record, successRate)
    const suggestedSkillName = this.toSuggestedSkillName(record.taskType)

    return {
      taskType: record.taskType,
      reason: `High-frequency workflow detected: ${record.successCount}/${record.totalCount} successful runs (${(successRate * 100).toFixed(0)}% success) with ${record.consecutiveSuccessCount} consecutive successes.`,
      confidence,
      suggestedSkillName,
      suggestedTriggers: this.toSuggestedTriggers(record.taskType),
      templateHint: `Create a reusable skill for \"${record.taskType}\". Capture stable prerequisites, inputs/outputs, failure recovery, and latency expectations (~${Math.round(record.avgLatencyMs)}ms average).`,
    }
  }

  private toConfidence(record: TaskStats, successRate: number): number {
    const streakScore = Math.min(record.consecutiveSuccessCount / 5, 1)
    const volumeScore = Math.min(record.totalCount / 10, 1)
    const successScore = Math.min(successRate, 1)
    const raw = successScore * 0.5 + streakScore * 0.3 + volumeScore * 0.2

    return Math.max(0, Math.min(1, Number(raw.toFixed(2))))
  }

  private toSuggestedSkillName(taskType: string): string {
    return taskType
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'new-skill'
  }

  private toSuggestedTriggers(taskType: string): string[] {
    const cleaned = taskType.trim()
    const kebab = this.toSuggestedSkillName(taskType)
    const words = cleaned
      .split(/[^\p{L}\p{N}]+/u)
      .map((word) => word.trim())
      .filter(Boolean)

    return Array.from(new Set([cleaned, kebab, ...words])).slice(0, 5)
  }

  private getSuccessRate(record: TaskStats): number {
    if (record.totalCount === 0) {
      return 0
    }

    return record.successCount / record.totalCount
  }

  private getSortedStats(): TaskStats[] {
    return Array.from(this.records.values()).sort((a, b) => {
      if (b.totalCount !== a.totalCount) {
        return b.totalCount - a.totalCount
      }

      return b.lastSeenAt - a.lastSeenAt
    })
  }

  private toNonNegativeNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
  }

  private toNonNegativeInteger(value: unknown): number {
    return Math.floor(this.toNonNegativeNumber(value))
  }

  private toTimestamp(value: unknown): number {
    const ts = this.toNonNegativeInteger(value)
    return ts > 0 ? ts : Date.now()
  }
}
