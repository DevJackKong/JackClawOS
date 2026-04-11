import type { SkillEntry, SkillRegistry } from '@jackclaw/memory'

export interface SkillMatchResult {
  matched: boolean
  skillId?: string
  skillName?: string
  confidence: number
  matchedTrigger?: string
  suggestedHandler?: string
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase()
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
    .map(token => token.trim())
    .filter(Boolean)
}

function uniqueTokens(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function clamp(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped.replace(/\\\*/g, '.*')}$`, 'i')
}

function successRate(skill: SkillEntry): number {
  const total = skill.meta.successCount + skill.meta.failureCount
  if (total <= 0) return 0.5
  return skill.meta.successCount / total
}

function experienceScore(skill: SkillEntry): number {
  const total = skill.meta.successCount + skill.meta.failureCount
  return clamp(total / 20)
}

function freshnessScore(skill: SkillEntry): number {
  const ageMs = Math.max(0, Date.now() - (skill.meta.updatedAt || 0))
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
  return clamp(1 - ageMs / thirtyDaysMs)
}

function triggerScore(taskType: string, trigger: string): number {
  const normalizedTask = normalizeText(taskType)
  const normalizedTrigger = normalizeText(trigger)

  if (!normalizedTask || !normalizedTrigger) return 0
  if (normalizedTask === normalizedTrigger) return 1
  if (normalizedTask.includes(normalizedTrigger) || normalizedTrigger.includes(normalizedTask)) return 0.92

  if (normalizedTrigger.includes('*') && wildcardToRegExp(normalizedTrigger).test(normalizedTask)) {
    return 0.88
  }

  const taskTokens = uniqueTokens(tokenize(normalizedTask))
  const triggerTokens = uniqueTokens(tokenize(normalizedTrigger.replace(/\*/g, ' ')))
  if (taskTokens.length === 0 || triggerTokens.length === 0) return 0

  const overlap = triggerTokens.filter(token => taskTokens.includes(token)).length
  if (overlap === 0) return 0

  const coverage = overlap / triggerTokens.length
  const density = overlap / taskTokens.length
  return clamp(coverage * 0.75 + density * 0.25)
}

function tagScore(taskType: string, tags: string[]): number {
  const taskTokens = uniqueTokens(tokenize(taskType))
  if (taskTokens.length === 0 || tags.length === 0) return 0

  let best = 0
  for (const tag of tags) {
    const tagTokens = uniqueTokens(tokenize(tag))
    if (tagTokens.length === 0) continue
    const overlap = tagTokens.filter(token => taskTokens.includes(token)).length
    if (overlap === 0) continue
    const score = overlap / tagTokens.length
    if (score > best) best = score
  }

  return clamp(best)
}

function describePayload(payload: Record<string, unknown>): string {
  const values: string[] = []

  for (const value of Object.values(payload)) {
    if (typeof value === 'string') {
      values.push(value)
      continue
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      values.push(String(value))
      continue
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
          values.push(String(item))
        }
      }
    }
  }

  return values.join(' ').trim()
}

export class SkillMatcher {
  private totalMatches = 0
  private hitMatches = 0

  constructor(private registry: SkillRegistry) {}

  match(task: { type: string; payload: Record<string, unknown> }): SkillMatchResult {
    this.totalMatches += 1

    const searchText = [task.type, describePayload(task.payload)].filter(Boolean).join(' ')
    const candidates = this.rankCandidates(searchText || task.type)
    const best = candidates[0]

    if (!best || !best.matched) {
      return { matched: false, confidence: 0 }
    }

    this.hitMatches += 1
    return best
  }

  findCandidates(taskType: string, limit = 5): SkillMatchResult[] {
    return this.rankCandidates(taskType).slice(0, Math.max(0, limit))
  }

  shouldUseSkill(result: SkillMatchResult): boolean {
    return result.matched && result.confidence > 0.7
  }

  getHitRate(): { total: number; hits: number; hitRate: number } {
    return {
      total: this.totalMatches,
      hits: this.hitMatches,
      hitRate: this.totalMatches === 0 ? 0 : this.hitMatches / this.totalMatches,
    }
  }

  private rankCandidates(taskType: string): SkillMatchResult[] {
    const normalizedTaskType = normalizeText(taskType)
    if (!normalizedTaskType) return []

    return this.registry
      .listAll()
      .filter(skill => !skill.meta.deprecated)
      .map(skill => this.scoreCandidate(normalizedTaskType, skill))
      .filter((result): result is SkillMatchResult => result !== null)
      .sort((a, b) => {
        const confidenceDiff = b.confidence - a.confidence
        if (confidenceDiff !== 0) return confidenceDiff
        return (a.skillName || '').localeCompare(b.skillName || '')
      })
  }

  private scoreCandidate(taskType: string, skill: SkillEntry): SkillMatchResult | null {
    let bestTrigger: string | undefined
    let bestTriggerScore = 0

    for (const trigger of skill.meta.triggerPatterns) {
      const score = triggerScore(taskType, trigger)
      if (score > bestTriggerScore) {
        bestTriggerScore = score
        bestTrigger = trigger
      }
    }

    const bestTagScore = tagScore(taskType, skill.meta.tags)
    const descriptionScore = skill.meta.description
      ? triggerScore(taskType, skill.meta.description)
      : 0

    const structuralScore = Math.max(bestTriggerScore, bestTagScore * 0.85, descriptionScore * 0.7)
    if (structuralScore <= 0) return null

    const confidence = clamp(
      structuralScore * 0.65 +
        successRate(skill) * 0.2 +
        experienceScore(skill) * 0.1 +
        freshnessScore(skill) * 0.05,
    )

    return {
      matched: confidence > 0,
      skillId: skill.meta.id,
      skillName: skill.meta.name,
      confidence,
      matchedTrigger: bestTrigger,
      suggestedHandler: skill.handler,
    }
  }
}
