import { SkillEvolutionDetector, type SkillCandidate } from './evolution-detector.js'
import { SkillRegistry, type SkillEntry } from './registry.js'

export interface GeneratedSkill {
  skillId: string
  skillName: string
  taskType: string
  generatedAt: number
  autoApproved: boolean
}

export class SkillAutoGenerator {
  constructor(
    private detector: SkillEvolutionDetector,
    private registry: SkillRegistry,
  ) {}

  async autoGenerate(): Promise<GeneratedSkill[]> {
    const candidates = this.detector.detect()
    const generated: GeneratedSkill[] = []

    for (const candidate of candidates) {
      if (this.isDuplicate(candidate.taskType)) {
        this.detector.markSkillized(candidate.taskType)
        continue
      }

      const entry = this.buildSkillEntry(candidate)
      this.registry.register(entry)
      this.detector.markSkillized(candidate.taskType)

      generated.push({
        skillId: entry.meta.id,
        skillName: entry.meta.name,
        taskType: candidate.taskType,
        generatedAt: entry.meta.createdAt,
        autoApproved: candidate.confidence >= 0.85,
      })
    }

    return generated
  }

  private buildSkillEntry(candidate: SkillCandidate): SkillEntry {
    const now = Date.now()
    const taskType = candidate.taskType.trim()
    const normalizedTaskType = this.toSlug(taskType)
    const skillName = candidate.suggestedSkillName?.trim() || normalizedTaskType || 'auto-generated-skill'
    const skillId = `auto-${skillName}`
    const sop = this.generateSOP(taskType, candidate)
    const avgLatencyMs = this.extractLatencyHint(candidate.templateHint)

    return {
      meta: {
        id: skillId,
        name: this.toDisplayName(skillName),
        description: candidate.reason,
        version: '0.1.0',
        tags: [...new Set(['auto-generated', 'skill-evolution', normalizedTaskType, ...candidate.suggestedTriggers.map((trigger) => this.toSlug(trigger)).filter(Boolean)])],
        triggerPatterns: [...new Set(candidate.suggestedTriggers.map((trigger) => trigger.trim()).filter(Boolean))],
        successCount: 0,
        failureCount: 0,
        avgLatencyMs,
        createdAt: now,
        updatedAt: now,
      },
      handler: JSON.stringify(
        {
          type: 'auto-generated-sop',
          taskType,
          confidence: candidate.confidence,
          templateHint: candidate.templateHint,
          sop,
        },
        null,
        2,
      ),
      dependencies: this.inferDependencies(taskType, candidate),
    }
  }

  private generateSOP(taskType: string, candidate: SkillCandidate): string[] {
    const normalized = `${taskType} ${candidate.templateHint} ${candidate.suggestedTriggers.join(' ')}`.toLowerCase()
    const steps = [
      `Clarify the goal, inputs, and success criteria for ${taskType}.`,
      'Validate prerequisites, permissions, and required context before execution.',
    ]

    if (this.matches(normalized, ['deploy', 'release', 'publish', 'ship'])) {
      steps.push('Run pre-deploy checks, build validation, and environment verification.')
      steps.push('Execute deployment in the target environment and capture release metadata.')
      steps.push('Verify service health, smoke-test critical paths, and prepare rollback notes if needed.')
    } else if (this.matches(normalized, ['review', 'pull request', 'pr', 'code review', 'diff'])) {
      steps.push('Inspect the changed scope, baseline context, and impacted modules.')
      steps.push('Evaluate correctness, regressions, tests, security, and maintainability issues.')
      steps.push('Summarize findings with severity, recommended fixes, and merge readiness.')
    } else if (this.matches(normalized, ['document', 'doc', 'write', 'report', 'summary'])) {
      steps.push('Collect source inputs, key facts, and required output structure.')
      steps.push('Draft the content in the target format with concise, reusable sections.')
      steps.push('Review clarity, completeness, and formatting before publishing the final output.')
    } else if (this.matches(normalized, ['debug', 'fix', 'incident', 'error', 'bug'])) {
      steps.push('Reproduce or isolate the issue with logs, failing cases, and recent changes.')
      steps.push('Apply the smallest reliable fix and validate with targeted regression checks.')
      steps.push('Document root cause, recovery steps, and follow-up prevention actions.')
    } else if (this.matches(normalized, ['data', 'sync', 'import', 'export', 'migration'])) {
      steps.push('Inspect source and target schemas, mappings, and data quality constraints.')
      steps.push('Execute the transfer or transformation with idempotent checkpoints.')
      steps.push('Verify counts, spot-check outputs, and log reconciliation results.')
    } else {
      steps.push('Execute the core workflow using the stable sequence inferred from prior successful runs.')
      steps.push('Validate outputs, edge cases, and recovery paths before returning results.')
    }

    steps.push('Record final outcome, notable exceptions, and reusable learnings for future runs.')

    return steps
  }

  private isDuplicate(taskType: string): boolean {
    const normalizedTaskType = this.toSlug(taskType)

    return this.registry.listAll().some((skill) => {
      if (skill.meta.id === `auto-${normalizedTaskType}`) {
        return true
      }

      if (this.toSlug(skill.meta.name) === normalizedTaskType) {
        return true
      }

      if (skill.meta.tags.some((tag) => this.toSlug(tag) === normalizedTaskType)) {
        return true
      }

      return skill.meta.triggerPatterns.some((pattern) => this.toSlug(pattern) === normalizedTaskType)
    })
  }

  private inferDependencies(taskType: string, candidate: SkillCandidate): string[] {
    const normalized = `${taskType} ${candidate.templateHint} ${candidate.reason}`.toLowerCase()
    const dependencies = ['context']

    if (this.matches(normalized, ['github', 'pr', 'pull request', 'repo'])) {
      dependencies.push('git', 'github')
    }

    if (this.matches(normalized, ['feishu', 'doc', 'wiki'])) {
      dependencies.push('feishu')
    }

    if (this.matches(normalized, ['deploy', 'release'])) {
      dependencies.push('ci', 'secrets')
    }

    if (this.matches(normalized, ['data', 'migration', 'sync'])) {
      dependencies.push('storage')
    }

    return [...new Set(dependencies)]
  }

  private extractLatencyHint(templateHint: string): number {
    const match = templateHint.match(/~(\d+)ms/i)
    return match ? Number(match[1]) : 0
  }

  private toSlug(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  private toDisplayName(value: string): string {
    return value
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
      .join(' ')
  }

  private matches(value: string, keywords: string[]): boolean {
    return keywords.some((keyword) => value.includes(keyword))
  }
}
