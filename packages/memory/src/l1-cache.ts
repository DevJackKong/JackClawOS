// L1 工作记忆 — 内存缓存，会话结束自动清理

import type { MemoryEntry, RecallOptions } from './types.js'

export class L1Cache {
  private cache: Map<string, MemoryEntry> = new Map()
  private timer: ReturnType<typeof setInterval>

  constructor(cleanupIntervalMs = 60_000) {
    this.timer = setInterval(() => this.evictExpired(), cleanupIntervalMs)
  }

  set(entry: MemoryEntry): void {
    this.cache.set(entry.id, entry)
  }

  get(id: string): MemoryEntry | undefined {
    const entry = this.cache.get(id)
    if (entry && entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(id)
      return undefined
    }
    return entry
  }

  query(opts: RecallOptions = {}): MemoryEntry[] {
    const now = Date.now()
    const results: MemoryEntry[] = []

    for (const entry of this.cache.values()) {
      if (entry.expiresAt && now > entry.expiresAt) continue
      if (opts.layer && entry.layer !== opts.layer) continue
      if (opts.category && entry.category !== opts.category) continue
      if (opts.scope && entry.scope !== opts.scope) continue
      if (opts.minImportance !== undefined && entry.importance < opts.minImportance) continue
      if (opts.tags?.length) {
        const has = opts.tags.some(t => entry.tags.includes(t))
        if (!has) continue
      }
      results.push(entry)
    }

    return results
      .sort((a, b) => b.importance - a.importance)
      .slice(0, opts.limit ?? 50)
  }

  delete(id: string): void {
    this.cache.delete(id)
  }

  clear(): void {
    this.cache.clear()
  }

  destroy(): void {
    clearInterval(this.timer)
    this.cache.clear()
  }

  private evictExpired(): void {
    const now = Date.now()
    for (const [id, entry] of this.cache) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.cache.delete(id)
      }
    }
  }
}
