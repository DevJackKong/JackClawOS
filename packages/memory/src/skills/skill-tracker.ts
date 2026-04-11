import fs from 'fs'
import path from 'path'

export interface SkillInvocation {
  skillId: string
  invokedAt: number
  success: boolean
  latencyMs: number
  errorMessage?: string
  taskType: string
}

interface SkillTrackerState {
  invocations: Record<string, SkillInvocation[]>
}

function normalizeInvocation(invocation: SkillInvocation): SkillInvocation {
  if (!invocation.skillId || !invocation.skillId.trim()) {
    throw new Error('skillId is required')
  }

  if (!invocation.taskType || !invocation.taskType.trim()) {
    throw new Error('taskType is required')
  }

  return {
    skillId: invocation.skillId.trim(),
    invokedAt: Number.isFinite(invocation.invokedAt) ? invocation.invokedAt : Date.now(),
    success: Boolean(invocation.success),
    latencyMs: Math.max(0, invocation.latencyMs ?? 0),
    errorMessage: typeof invocation.errorMessage === 'string' && invocation.errorMessage.trim()
      ? invocation.errorMessage.trim()
      : undefined,
    taskType: invocation.taskType.trim(),
  }
}

function cloneInvocation(invocation: SkillInvocation): SkillInvocation {
  return { ...invocation }
}

function getTrend(invocations: SkillInvocation[]): 'improving' | 'degrading' | 'stable' {
  if (invocations.length < 4) {
    return 'stable'
  }

  const recent = invocations.slice(-10)
  const midpoint = Math.floor(recent.length / 2)
  const firstHalf = recent.slice(0, midpoint)
  const secondHalf = recent.slice(midpoint)

  if (firstHalf.length === 0 || secondHalf.length === 0) {
    return 'stable'
  }

  const firstRate = firstHalf.filter((item) => item.success).length / firstHalf.length
  const secondRate = secondHalf.filter((item) => item.success).length / secondHalf.length
  const delta = secondRate - firstRate

  if (delta >= 0.2) {
    return 'improving'
  }

  if (delta <= -0.2) {
    return 'degrading'
  }

  return 'stable'
}

export class SkillTracker {
  private readonly invocations = new Map<string, SkillInvocation[]>()

  record(invocation: SkillInvocation): void {
    const normalized = normalizeInvocation(invocation)
    const history = this.invocations.get(normalized.skillId) ?? []
    history.push(normalized)
    history.sort((left, right) => left.invokedAt - right.invokedAt)
    this.invocations.set(normalized.skillId, history)
  }

  getStats(skillId: string): {
    totalInvocations: number
    successRate: number
    avgLatencyMs: number
    recentFailures: number
    trend: 'improving' | 'degrading' | 'stable'
  } {
    const history = this.invocations.get(skillId)?.map(cloneInvocation) ?? []
    const totalInvocations = history.length

    if (totalInvocations === 0) {
      return {
        totalInvocations: 0,
        successRate: 0,
        avgLatencyMs: 0,
        recentFailures: 0,
        trend: 'stable',
      }
    }

    const successCount = history.filter((item) => item.success).length
    const avgLatencyMs = history.reduce((sum, item) => sum + item.latencyMs, 0) / totalInvocations
    const recentFailures = history.slice(-10).filter((item) => !item.success).length

    return {
      totalInvocations,
      successRate: successCount / totalInvocations,
      avgLatencyMs,
      recentFailures,
      trend: getTrend(history),
    }
  }

  shouldUpgrade(skillId: string): boolean {
    const history = this.invocations.get(skillId) ?? []
    if (history.length < 3) {
      return false
    }

    return history.slice(-3).every((item) => !item.success)
  }

  shouldDeprecate(skillId: string): boolean {
    const stats = this.getStats(skillId)
    return stats.totalInvocations > 0 && stats.successRate < 0.3
  }

  getSkillsNeedingAttention(): Array<{
    skillId: string
    reason: 'upgrade' | 'deprecate' | 'review'
    urgency: 'low' | 'medium' | 'high'
  }> {
    const results: Array<{
      skillId: string
      reason: 'upgrade' | 'deprecate' | 'review'
      urgency: 'low' | 'medium' | 'high'
    }> = []

    for (const [skillId, history] of this.invocations.entries()) {
      const stats = this.getStats(skillId)

      if (this.shouldUpgrade(skillId)) {
        results.push({
          skillId,
          reason: 'upgrade',
          urgency: 'high',
        })
        continue
      }

      if (this.shouldDeprecate(skillId)) {
        results.push({
          skillId,
          reason: 'deprecate',
          urgency: stats.successRate < 0.15 || history.length >= 10 ? 'high' : 'medium',
        })
        continue
      }

      if (stats.trend === 'degrading' || stats.recentFailures >= 5) {
        results.push({
          skillId,
          reason: 'review',
          urgency: stats.recentFailures >= 7 ? 'high' : stats.recentFailures >= 3 ? 'medium' : 'low',
        })
      }
    }

    return results.sort((left, right) => {
      const urgencyRank = { high: 0, medium: 1, low: 2 }
      const urgencyDelta = urgencyRank[left.urgency] - urgencyRank[right.urgency]
      if (urgencyDelta !== 0) {
        return urgencyDelta
      }

      return left.skillId.localeCompare(right.skillId)
    })
  }

  save(filePath: string): void {
    const state: SkillTrackerState = {
      invocations: Object.fromEntries(
        Array.from(this.invocations.entries()).map(([skillId, history]) => [
          skillId,
          history.map(cloneInvocation),
        ]),
      ),
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8')
  }

  load(filePath: string): void {
    if (!fs.existsSync(filePath)) {
      this.invocations.clear()
      return
    }

    const raw = fs.readFileSync(filePath, 'utf-8').trim()
    if (!raw) {
      this.invocations.clear()
      return
    }

    const parsed = JSON.parse(raw) as SkillTrackerState | Record<string, SkillInvocation[]>
    const records = 'invocations' in parsed ? parsed.invocations : parsed

    this.invocations.clear()

    for (const [skillId, history] of Object.entries(records ?? {})) {
      if (!Array.isArray(history)) {
        continue
      }

      const normalizedHistory = history.map((item) => normalizeInvocation({
        ...item,
        skillId,
      }))
      normalizedHistory.sort((left, right) => left.invokedAt - right.invokedAt)
      this.invocations.set(skillId, normalizedHistory)
    }
  }
}
