// 语义去重 — Levenshtein 距离 + 关键词重叠

import type { MemoryEntry } from './types.js'

/** 计算两个字符串的 Levenshtein 距离 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]!
      } else {
        dp[i]![j] = 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!)
      }
    }
  }
  return dp[m]![n]!
}

/** 0-1 相似度（1 = 完全相同） */
function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshteinDistance(a, b) / maxLen
}

/** 关键词重叠率（基于 token 集合） */
function keywordOverlap(a: string, b: string): number {
  const tokenize = (s: string) =>
    new Set(s.toLowerCase().split(/\W+/).filter(t => t.length > 1))
  const setA = tokenize(a)
  const setB = tokenize(b)
  if (setA.size === 0 && setB.size === 0) return 1
  const intersection = [...setA].filter(t => setB.has(t)).length
  const union = new Set([...setA, ...setB]).size
  return intersection / union
}

/** 综合相似度（字符串 + 关键词各占 50%） */
export function similarity(a: string, b: string): number {
  return 0.5 * stringSimilarity(a, b) + 0.5 * keywordOverlap(a, b)
}

/** 判断两个 entry 是否足够相似，可以合并 */
export function isSimilar(a: MemoryEntry, b: MemoryEntry, threshold = 0.75): boolean {
  if (a.category !== b.category) return false
  if (a.scope !== b.scope) return false
  return similarity(a.content, b.content) >= threshold
}

/**
 * 压缩 entry 列表，合并相似条目
 * - 保留 importance 较高的一条
 * - 合并 tags
 * - 返回合并数量
 */
export function compress(entries: MemoryEntry[]): { entries: MemoryEntry[]; merged: number } {
  const result: MemoryEntry[] = []
  let merged = 0

  for (const entry of entries) {
    const existing = result.find(e => isSimilar(e, entry))
    if (existing) {
      // 合并：保留 importance 高的内容，合并 tags
      if (entry.importance > existing.importance) {
        existing.content = entry.content
        existing.importance = entry.importance
      }
      const combined = new Set([...existing.tags, ...entry.tags])
      existing.tags = [...combined]
      existing.updatedAt = Date.now()
      merged++
    } else {
      result.push({ ...entry })
    }
  }

  return { entries: result, merged }
}
