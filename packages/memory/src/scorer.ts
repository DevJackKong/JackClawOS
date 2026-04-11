import type { MemoryEntry } from './types.js'

export interface MemoryScore {
  entryId: string
  totalScore: number
  hitScore: number
  recencyScore: number
  successScore: number
  reliabilityScore: number
  isStale: boolean
  staleSince?: number
}

export interface MemoryScorerWeights {
  hitFrequency: number
  recency: number
  successRate: number
  reliability: number
}

type StaleRecord = {
  reason: string
  staleSince: number
}

type ScorableEntry = MemoryEntry & {
  hitCount?: number
  hits?: number
  accessCount?: number
  recallCount?: number
  lastAccessAt?: number
  lastHitAt?: number
  lastUsedAt?: number
  successCount?: number
  successes?: number
  failureCount?: number
  failures?: number
  attemptCount?: number
  attempts?: number
  reliability?: number
  reliabilityScore?: number
  verified?: boolean
  source?: string
}

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_HALF_LIFE_DAYS = 30
const DEFAULT_STALE_AFTER_DAYS = 30

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter(token => token.length > 1)
}

function keywordOverlap(query: string, content: string): number {
  const q = new Set(tokenize(query))
  const c = new Set(tokenize(content))
  if (!q.size || !c.size) return 0

  let overlap = 0
  for (const token of q) {
    if (c.has(token)) overlap++
  }
  return overlap / q.size
}

function sourceReliability(source?: string, verified?: boolean): number {
  const normalized = source?.toLowerCase() ?? ''

  let base = 0.6
  if (!normalized) base = 0.5
  else if (normalized.includes('system') || normalized.includes('verified')) base = 0.95
  else if (normalized.includes('user') || normalized.includes('manual')) base = 0.85
  else if (normalized.includes('agent') || normalized.includes('assistant')) base = 0.75
  else if (normalized.includes('peer') || normalized.includes('shared')) base = 0.65
  else if (normalized.includes('external') || normalized.includes('import')) base = 0.55

  if (verified === true) base = Math.max(base, 0.9)
  if (verified === false) base = Math.min(base, 0.35)

  return clamp01(base)
}

export class MemoryScorer {
  weights: MemoryScorerWeights

  private readonly staleMarks = new Map<string, StaleRecord>()
  private readonly halfLifeDays: number
  private readonly staleAfterDays: number

  constructor(weights: Partial<MemoryScorerWeights> = {}, options?: { halfLifeDays?: number; staleAfterDays?: number }) {
    this.weights = {
      hitFrequency: 0.3,
      recency: 0.3,
      successRate: 0.3,
      reliability: 0.1,
      ...weights,
    }
    this.halfLifeDays = options?.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS
    this.staleAfterDays = options?.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS
  }

  score(entry: MemoryEntry): MemoryScore {
    const candidate = entry as ScorableEntry
    const hitScore = this.computeHitScore(candidate)
    const recencyScore = this.computeRecencyScore(candidate)
    const successScore = this.computeSuccessScore(candidate)
    const reliabilityScore = this.computeReliabilityScore(candidate)

    const totalWeight = Object.values(this.weights).reduce((sum, value) => sum + value, 0) || 1
    const weightedTotal =
      hitScore * this.weights.hitFrequency +
      recencyScore * this.weights.recency +
      successScore * this.weights.successRate +
      reliabilityScore * this.weights.reliability

    const staleInfo = this.resolveStaleness(candidate, recencyScore)

    return {
      entryId: entry.id,
      totalScore: clamp01(weightedTotal / totalWeight),
      hitScore,
      recencyScore,
      successScore,
      reliabilityScore,
      isStale: staleInfo.isStale,
      staleSince: staleInfo.staleSince,
    }
  }

  rankByRelevance(entries: MemoryEntry[], query: string): MemoryEntry[] {
    const normalizedQuery = query.trim()

    return [...entries]
      .map(entry => {
        const base = this.score(entry)
        const queryBoost = normalizedQuery
          ? this.computeQueryBoost(entry as ScorableEntry, normalizedQuery)
          : 0
        const finalScore = clamp01(base.totalScore * 0.8 + queryBoost * 0.2)
        return { entry, finalScore, isStale: base.isStale }
      })
      .sort((a, b) => {
        if (a.isStale !== b.isStale) return a.isStale ? 1 : -1
        return b.finalScore - a.finalScore
      })
      .map(item => item.entry)
  }

  markStale(entryId: string, reason: string): void {
    this.staleMarks.set(entryId, {
      reason,
      staleSince: Date.now(),
    })
  }

  pruneStaleEntries(entries: MemoryEntry[], threshold: number): MemoryEntry[] {
    const cutoff = clamp01(threshold)
    return entries.filter(entry => {
      const scored = this.score(entry)
      return !scored.isStale && scored.totalScore >= cutoff
    })
  }

  private computeHitScore(entry: ScorableEntry): number {
    const hits =
      entry.hitCount ??
      entry.hits ??
      entry.accessCount ??
      entry.recallCount ??
      0

    if (hits <= 0) return 0

    return clamp01(Math.log1p(hits) / Math.log1p(10))
  }

  private computeRecencyScore(entry: ScorableEntry): number {
    const latestTs =
      entry.lastAccessAt ??
      entry.lastHitAt ??
      entry.lastUsedAt ??
      entry.updatedAt ??
      entry.createdAt

    if (!latestTs) return 0.5

    const ageDays = Math.max(0, Date.now() - latestTs) / DAY_MS
    const decay = Math.exp(-Math.log(2) * ageDays / this.halfLifeDays)
    return clamp01(decay)
  }

  private computeSuccessScore(entry: ScorableEntry): number {
    const successes = entry.successCount ?? entry.successes ?? 0
    const failures = entry.failureCount ?? entry.failures ?? 0
    const attempts = entry.attemptCount ?? entry.attempts ?? successes + failures

    if (attempts <= 0) {
      return successes > 0 ? 1 : 0.5
    }

    return clamp01(successes / attempts)
  }

  private computeReliabilityScore(entry: ScorableEntry): number {
    if (typeof entry.reliability === 'number') return clamp01(entry.reliability)
    if (typeof entry.reliabilityScore === 'number') return clamp01(entry.reliabilityScore)
    return sourceReliability(entry.source, entry.verified)
  }

  private computeQueryBoost(entry: ScorableEntry, query: string): number {
    const tags = Array.isArray(entry.tags) ? entry.tags.join(' ') : ''
    const searchableText = [entry.content, tags, entry.category, entry.source]
      .filter(Boolean)
      .join(' ')

    return keywordOverlap(query, searchableText)
  }

  private resolveStaleness(entry: ScorableEntry, recencyScore: number): { isStale: boolean; staleSince?: number } {
    const manual = this.staleMarks.get(entry.id)
    if (manual) {
      return { isStale: true, staleSince: manual.staleSince }
    }

    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      return { isStale: true, staleSince: entry.expiresAt }
    }

    const latestTs = entry.updatedAt ?? entry.createdAt
    if (!latestTs) {
      return recencyScore < 0.2 ? { isStale: true, staleSince: Date.now() } : { isStale: false }
    }

    const staleAt = latestTs + this.staleAfterDays * DAY_MS
    if (Date.now() > staleAt) {
      return { isStale: true, staleSince: staleAt }
    }

    return { isStale: false }
  }
}
