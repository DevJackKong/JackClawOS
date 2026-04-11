import { SkillRegistry } from './registry.js'

export type SkillCallResult = 'success' | 'failure'

export interface SkillCallStats {
  skillId: string
  successRate: number
  averageLatencyMs: number
  callCount: number
  successCount: number
  failureCount: number
  stale: boolean
}

type RegistrySkillMeta = {
  successCount: number
  failureCount: number
  avgLatencyMs: number
  updatedAt: number
  stale?: boolean
}

type RegistrySkillEntry = {
  meta: RegistrySkillMeta
}

type RegistryInternals = {
  skills: Map<string, RegistrySkillEntry>
}

export class SkillCallTracker {
  constructor(private readonly registry: SkillRegistry) {}

  trackCall(skillId: string, result: SkillCallResult, latencyMs: number): SkillCallStats {
    const normalizedSkillId = skillId.trim()
    if (!normalizedSkillId) {
      throw new Error('Skill ID is required')
    }

    const safeLatencyMs = Number.isFinite(latencyMs) ? Math.max(0, latencyMs) : 0
    const success = result === 'success'

    this.registry.recordResult(normalizedSkillId, success, safeLatencyMs)

    const stats = this.getStats(normalizedSkillId)
    this.setStaleFlag(normalizedSkillId, stats.failureCount > 0 && stats.failureCount / stats.callCount > 0.6)

    return this.getStats(normalizedSkillId)
  }

  getStats(skillId: string): SkillCallStats {
    const normalizedSkillId = skillId.trim()
    if (!normalizedSkillId) {
      throw new Error('Skill ID is required')
    }

    const skill = this.registry.get(normalizedSkillId)
    if (!skill) {
      throw new Error(`Skill not found: ${normalizedSkillId}`)
    }

    const successCount = skill.meta.successCount
    const failureCount = skill.meta.failureCount
    const callCount = successCount + failureCount
    const successRate = callCount === 0 ? 0 : successCount / callCount
    const stale = this.readStaleFlag(normalizedSkillId)

    return {
      skillId: normalizedSkillId,
      successRate,
      averageLatencyMs: skill.meta.avgLatencyMs,
      callCount,
      successCount,
      failureCount,
      stale,
    }
  }

  private readStaleFlag(skillId: string): boolean {
    const entry = this.getMutableEntry(skillId)
    return entry?.meta.stale === true
  }

  private setStaleFlag(skillId: string, stale: boolean): void {
    const entry = this.getMutableEntry(skillId)
    if (!entry) {
      throw new Error(`Skill not found: ${skillId}`)
    }

    entry.meta.stale = stale
    entry.meta.updatedAt = Date.now()
  }

  private getMutableEntry(skillId: string): RegistrySkillEntry | undefined {
    const internals = this.registry as unknown as RegistryInternals
    return internals.skills.get(skillId)
  }
}
