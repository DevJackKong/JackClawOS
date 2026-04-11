import type { MemoryEntry } from './types.js'

export interface CompactionResult {
  before: number
  after: number
  merged: number
  removed: number
  compressed: number
  log: string[]
}

type ScoredMemoryEntry = MemoryEntry & { score?: number }

const SIMILARITY_THRESHOLD = 0.85
const DEFAULT_PRUNE_THRESHOLD = 0.3
const STALE_DAYS = 30
const SUMMARY_MAX_LENGTH = 120

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .map(token => token.trim())
      .filter(token => token.length > 1)
  )
}

function jaccardSimilarity(a: string, b: string): number {
  if (a === b) return 1

  const setA = tokenize(a)
  const setB = tokenize(b)

  if (setA.size === 0 && setB.size === 0) return 1
  if (setA.size === 0 || setB.size === 0) return 0

  let intersection = 0
  for (const token of setA) {
    if (setB.has(token)) intersection++
  }

  const union = new Set([...setA, ...setB]).size
  return union === 0 ? 0 : intersection / union
}

function normalizeContent(content: string): string {
  return content.replace(/\s+/g, ' ').trim()
}

function entryScore(entry: MemoryEntry): number {
  const scored = entry as ScoredMemoryEntry
  if (typeof scored.score === 'number') return scored.score
  return typeof entry.importance === 'number' ? entry.importance : 0
}

function summarizeContent(content: string, maxLength = SUMMARY_MAX_LENGTH): string {
  const normalized = normalizeContent(content)
  if (normalized.length <= maxLength) return normalized

  const sentences = normalized
    .split(/(?<=[。！？.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(Boolean)

  if (sentences.length === 0) {
    return `${normalized.slice(0, maxLength - 1).trimEnd()}…`
  }

  let summary = ''
  for (const sentence of sentences) {
    const next = summary ? `${summary} ${sentence}` : sentence
    if (next.length > maxLength) break
    summary = next
  }

  if (!summary) {
    return `${sentences[0]!.slice(0, maxLength - 1).trimEnd()}…`
  }

  return summary.length < normalized.length ? `${summary} …` : summary
}

function mergeEntries(primary: MemoryEntry, duplicate: MemoryEntry): MemoryEntry {
  const winner = primary.importance >= duplicate.importance ? primary : duplicate
  const loser = winner === primary ? duplicate : primary

  return {
    ...winner,
    content: winner.content.length >= loser.content.length ? winner.content : loser.content,
    tags: [...new Set([...(primary.tags ?? []), ...(duplicate.tags ?? [])])],
    importance: Math.max(primary.importance ?? 0, duplicate.importance ?? 0),
    createdAt: Math.min(primary.createdAt, duplicate.createdAt),
    updatedAt: Math.max(primary.updatedAt, duplicate.updatedAt),
    expiresAt:
      primary.expiresAt && duplicate.expiresAt
        ? Math.max(primary.expiresAt, duplicate.expiresAt)
        : (primary.expiresAt ?? duplicate.expiresAt),
    source: winner.source ?? loser.source,
  }
}

export class MemoryCompactor {
  deduplicate(entries: MemoryEntry[]): MemoryEntry[] {
    const deduped: MemoryEntry[] = []

    for (const entry of entries) {
      const normalized = normalizeContent(entry.content)
      let merged = false

      for (let i = 0; i < deduped.length; i++) {
        const existing = deduped[i]!
        const sameCategory = existing.category === entry.category
        const sameScope = existing.scope === entry.scope
        const similarity = jaccardSimilarity(normalizeContent(existing.content), normalized)

        if (sameCategory && sameScope && similarity > SIMILARITY_THRESHOLD) {
          deduped[i] = mergeEntries(existing, entry)
          merged = true
          break
        }
      }

      if (!merged) {
        deduped.push({ ...entry, tags: [...(entry.tags ?? [])] })
      }
    }

    return deduped
  }

  compressStale(entries: MemoryEntry[]): MemoryEntry[] {
    const cutoff = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000

    return entries.map(entry => {
      const isStale = entry.updatedAt < cutoff || (entry.expiresAt !== undefined && entry.expiresAt < Date.now())
      if (!isStale) return { ...entry, tags: [...(entry.tags ?? [])] }

      const summarized = summarizeContent(entry.content)
      if (summarized === normalizeContent(entry.content)) {
        return { ...entry, tags: [...(entry.tags ?? [])] }
      }

      return {
        ...entry,
        content: summarized,
        tags: [...new Set([...(entry.tags ?? []), 'compressed'])],
        updatedAt: Date.now(),
      }
    })
  }

  prune(entries: MemoryEntry[], scoreThreshold: number): {
    kept: MemoryEntry[]
    removed: MemoryEntry[]
    reason: string[]
  } {
    const kept: MemoryEntry[] = []
    const removed: MemoryEntry[] = []
    const reason: string[] = []

    for (const entry of entries) {
      const score = entryScore(entry)
      if (score < scoreThreshold) {
        removed.push(entry)
        reason.push(`${entry.id}: score ${score.toFixed(2)} < ${scoreThreshold.toFixed(2)}`)
      } else {
        kept.push(entry)
      }
    }

    return { kept, removed, reason }
  }

  compact(entries: MemoryEntry[]): CompactionResult {
    const before = entries.length
    const deduped = this.deduplicate(entries)
    const merged = before - deduped.length

    const compressedEntries = this.compressStale(deduped)
    let compressed = 0
    for (let i = 0; i < deduped.length; i++) {
      if (compressedEntries[i] && compressedEntries[i]!.content !== deduped[i]!.content) {
        compressed++
      }
    }

    const pruned = this.prune(compressedEntries, DEFAULT_PRUNE_THRESHOLD)
    const after = pruned.kept.length
    const removed = pruned.removed.length

    const log: string[] = [
      `before=${before}`,
      `deduplicate: merged ${merged}`,
      `compressStale: compressed ${compressed}`,
      `prune: removed ${removed}`,
      `after=${after}`,
      ...pruned.reason,
    ]

    return {
      before,
      after,
      merged,
      removed,
      compressed,
      log,
    }
  }
}
