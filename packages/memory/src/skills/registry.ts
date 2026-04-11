import fs from 'fs'
import path from 'path'

export interface SkillMeta {
  id: string
  name: string
  description: string
  version: string
  tags: string[]
  triggerPatterns: string[]
  successCount: number
  failureCount: number
  avgLatencyMs: number
  createdAt: number
  updatedAt: number
  deprecated?: boolean
}

export interface SkillEntry {
  meta: SkillMeta
  handler: string
  dependencies: string[]
}

interface SkillRegistryState {
  skills: SkillEntry[]
}

function normalizeSkill(skill: SkillEntry): SkillEntry {
  const now = Date.now()
  const createdAt = skill.meta.createdAt || now
  const updatedAt = skill.meta.updatedAt || now

  return {
    meta: {
      ...skill.meta,
      tags: [...new Set(skill.meta.tags.map(tag => tag.trim()).filter(Boolean))],
      triggerPatterns: [...new Set(skill.meta.triggerPatterns.map(pattern => pattern.trim()).filter(Boolean))],
      successCount: Math.max(0, skill.meta.successCount ?? 0),
      failureCount: Math.max(0, skill.meta.failureCount ?? 0),
      avgLatencyMs: Math.max(0, skill.meta.avgLatencyMs ?? 0),
      createdAt,
      updatedAt,
    },
    handler: skill.handler,
    dependencies: [...new Set(skill.dependencies.map(dep => dep.trim()).filter(Boolean))],
  }
}

function cloneSkill(skill: SkillEntry): SkillEntry {
  return {
    meta: {
      ...skill.meta,
      tags: [...skill.meta.tags],
      triggerPatterns: [...skill.meta.triggerPatterns],
    },
    handler: skill.handler,
    dependencies: [...skill.dependencies],
  }
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function scoreSkill(skill: SkillEntry): number {
  const total = skill.meta.successCount + skill.meta.failureCount
  if (total === 0) return 0
  return skill.meta.successCount / total
}

export class SkillRegistry {
  private readonly skills = new Map<string, SkillEntry>()

  register(skill: SkillEntry): void {
    const normalized = normalizeSkill(skill)
    this.skills.set(normalized.meta.id, normalized)
  }

  unregister(skillId: string): void {
    this.skills.delete(skillId)
  }

  get(skillId: string): SkillEntry | null {
    const skill = this.skills.get(skillId)
    return skill ? cloneSkill(skill) : null
  }

  findByTag(tag: string): SkillEntry[] {
    const target = tag.trim().toLowerCase()
    if (!target) return []

    return this.listAll().filter(skill =>
      skill.meta.tags.some(item => item.toLowerCase() === target),
    )
  }

  findByTrigger(input: string): SkillEntry[] {
    const normalizedInput = input.trim().toLowerCase()
    if (!normalizedInput) return []

    return this.listAll().filter(skill =>
      skill.meta.triggerPatterns.some(pattern => {
        const normalizedPattern = pattern.trim().toLowerCase()
        if (!normalizedPattern) return false
        if (normalizedInput.includes(normalizedPattern)) return true
        const wildcardRegex = new RegExp(
          normalizedPattern
            .split('*')
            .map(part => escapeRegExp(part))
            .join('.*'),
          'i',
        )
        return wildcardRegex.test(normalizedInput)
      }),
    )
  }

  listAll(): SkillEntry[] {
    return Array.from(this.skills.values()).map(cloneSkill)
  }

  recordResult(skillId: string, success: boolean, latencyMs: number): void {
    const existing = this.skills.get(skillId)
    if (!existing) {
      throw new Error(`Skill not found: ${skillId}`)
    }

    const totalBefore = existing.meta.successCount + existing.meta.failureCount
    const safeLatency = Math.max(0, latencyMs)
    const totalLatency = existing.meta.avgLatencyMs * totalBefore + safeLatency

    if (success) {
      existing.meta.successCount += 1
    } else {
      existing.meta.failureCount += 1
    }

    const totalAfter = existing.meta.successCount + existing.meta.failureCount
    existing.meta.avgLatencyMs = totalAfter === 0 ? 0 : totalLatency / totalAfter
    existing.meta.updatedAt = Date.now()
  }

  getTopSkills(n = 10): SkillEntry[] {
    return this.listAll()
      .sort((a, b) => {
        const scoreDiff = scoreSkill(b) - scoreSkill(a)
        if (scoreDiff !== 0) return scoreDiff

        const successDiff = b.meta.successCount - a.meta.successCount
        if (successDiff !== 0) return successDiff

        return a.meta.avgLatencyMs - b.meta.avgLatencyMs
      })
      .slice(0, Math.max(0, n))
  }

  save(filePath: string): void {
    const state: SkillRegistryState = {
      skills: this.listAll(),
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8')
  }

  load(filePath: string): void {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Skill registry file not found: ${filePath}`)
    }

    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as SkillRegistryState | SkillEntry[]
    const skills = Array.isArray(parsed) ? parsed : parsed.skills

    this.skills.clear()
    for (const skill of skills ?? []) {
      this.register(skill)
    }
  }
}
