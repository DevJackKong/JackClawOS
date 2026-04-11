import type { MemDir, MemoryEntry, MemoryType } from './types.js'
import { MemoryManager } from './manager.js'

export type TriggerType = 'repo' | 'deploy' | 'tool-error' | 'user-mention' | 'repeated-failure'

export interface TriggerEvent {
  type: TriggerType
  context: Record<string, string>
}

interface TriggerRule {
  trigger: TriggerType
  memoryTypes: MemoryType[]
  tags: string[]
}

/**
 * Event-triggered retriever.
 *
 * Goals:
 * - rule-based targeted recall
 * - avoid broad semantic scans / all-memory ranking
 * - prefer recent, high-signal entries matched by type + tags + context terms
 */
export class EventRetriever {
  private readonly rules = new Map<TriggerType, TriggerRule[]>()

  constructor(
    private readonly nodeId: string,
    private readonly manager = new MemoryManager(),
  ) {
    this.setupDefaultRules()
  }

  registerRule(trigger: TriggerType, memoryTypes: MemoryType[], tags: string[] = []): void {
    const existing = this.rules.get(trigger) ?? []
    existing.push({
      trigger,
      memoryTypes: [...new Set(memoryTypes)],
      tags: this.normalizeTags(tags),
    })
    this.rules.set(trigger, existing)
  }

  async retrieve(event: TriggerEvent, limit = 5): Promise<MemoryEntry[]> {
    const rules = this.rules.get(event.type) ?? []
    if (!rules.length || limit <= 0) return []

    const contextTags = this.extractContextTags(event)
    const contextTerms = this.extractContextTerms(event)
    const seen = new Set<string>()
    const scored: Array<{ entry: MemDir; score: number }> = []

    for (const rule of rules) {
      for (const memoryType of rule.memoryTypes) {
        const tagGroups = this.buildTagGroups(rule.tags, contextTags)

        if (tagGroups.length === 0) {
          const entries = this.manager.query(this.nodeId, {
            type: memoryType,
            limit: Math.max(limit * 3, 10),
          })
          this.collect(entries, contextTerms, seen, scored)
          continue
        }

        for (const tags of tagGroups) {
          const entries = this.manager.query(this.nodeId, {
            type: memoryType,
            tags,
            limit: Math.max(limit * 2, 8),
          })
          this.collect(entries, contextTerms, seen, scored)
        }
      }
    }

    return scored
      .sort((a, b) => b.score - a.score || b.entry.updatedAt - a.entry.updatedAt)
      .slice(0, limit)
      .map(item => item.entry as unknown as MemoryEntry)
  }

  private setupDefaultRules(): void {
    this.registerRule('repo', ['project', 'reference'], ['repo', 'history'])
    this.registerRule('deploy', ['feedback', 'reference'], ['deploy', 'failure'])
    this.registerRule('tool-error', ['feedback', 'reference'], ['tool', 'error', 'troubleshoot'])
    this.registerRule('user-mention', ['user', 'project'], ['mention', 'context'])
    this.registerRule('repeated-failure', ['feedback', 'project'], ['success', 'strategy'])
  }

  private buildTagGroups(ruleTags: string[], contextTags: string[]): string[][] {
    const groups: string[][] = []
    const normalizedRuleTags = this.normalizeTags(ruleTags)
    const normalizedContextTags = this.normalizeTags(contextTags)

    if (normalizedRuleTags.length) groups.push(normalizedRuleTags)

    for (const contextTag of normalizedContextTags) {
      if (normalizedRuleTags.length) {
        groups.push([...normalizedRuleTags, contextTag])
      }
      groups.push([contextTag])
    }

    if (!groups.length && normalizedContextTags.length) {
      groups.push(normalizedContextTags)
    }

    const unique = new Map<string, string[]>()
    for (const group of groups) {
      const normalized = this.normalizeTags(group)
      if (!normalized.length) continue
      unique.set(normalized.join('::'), normalized)
    }
    return [...unique.values()]
  }

  private collect(
    entries: MemDir[],
    contextTerms: string[],
    seen: Set<string>,
    scored: Array<{ entry: MemDir; score: number }>,
  ): void {
    for (const entry of entries) {
      if (seen.has(entry.id)) continue
      seen.add(entry.id)
      scored.push({ entry, score: this.scoreEntry(entry, contextTerms) })
    }
  }

  private scoreEntry(entry: MemDir, contextTerms: string[]): number {
    const haystack = `${entry.content} ${(entry.why ?? '')} ${(entry.howToApply ?? '')} ${(entry.tags ?? []).join(' ')}`.toLowerCase()

    let contextHits = 0
    for (const term of contextTerms) {
      if (term && haystack.includes(term)) contextHits += 1
    }

    const freshnessDays = (Date.now() - entry.updatedAt) / 86_400_000
    const freshnessBoost = Math.exp(-freshnessDays / 45)
    const verifiedBoost = entry.verified === false ? 0 : 0.2

    return contextHits * 3 + freshnessBoost + verifiedBoost
  }

  private extractContextTags(event: TriggerEvent): string[] {
    const tags = new Set<string>()

    for (const [key, value] of Object.entries(event.context)) {
      const normalizedKey = this.normalizeToken(key)
      const normalizedValue = this.normalizeToken(value)
      if (normalizedKey) tags.add(normalizedKey)
      if (normalizedValue) tags.add(normalizedValue)
    }

    switch (event.type) {
      case 'repo':
        tags.add('repo')
        tags.add('history')
        break
      case 'deploy':
        tags.add('deploy')
        tags.add('failure')
        break
      case 'tool-error':
        tags.add('tool')
        tags.add('error')
        tags.add('troubleshoot')
        break
      case 'user-mention':
        tags.add('mention')
        tags.add('context')
        break
      case 'repeated-failure':
        tags.add('failure')
        tags.add('success')
        tags.add('strategy')
        break
    }

    return [...tags]
  }

  private extractContextTerms(event: TriggerEvent): string[] {
    const terms = new Set<string>()

    for (const [key, value] of Object.entries(event.context)) {
      const normalizedKey = this.normalizeToken(key)
      if (normalizedKey) terms.add(normalizedKey)

      const raw = value.trim().toLowerCase()
      if (raw) terms.add(raw)

      for (const part of raw.split(/[^a-z0-9_-]+/i)) {
        const normalized = this.normalizeToken(part)
        if (normalized) terms.add(normalized)
      }
    }

    return [...terms]
  }

  private normalizeTags(tags: string[]): string[] {
    return [...new Set(tags.map(tag => this.normalizeToken(tag)).filter((tag): tag is string => Boolean(tag)))]
  }

  private normalizeToken(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9:_-]/g, '')
  }
}
