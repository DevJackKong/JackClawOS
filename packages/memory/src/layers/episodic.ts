// EpisodicMemory — 情节记忆，保存最近 N 条任务执行记录

import type { MemoryLayerAdapter } from './working.js'

export type EpisodicResult = 'success' | 'failure' | 'partial'

export interface EpisodicMemoryEntry {
  id: string
  taskId: string
  summary: string
  result: EpisodicResult
  startedAt: number
  endedAt: number
  tags: string[]
  metadata?: Record<string, unknown>
}

export interface EpisodicMemoryStoreInput {
  id?: string
  taskId: string
  summary: string
  result: EpisodicResult
  startedAt?: number
  endedAt?: number
  tags?: string[]
  metadata?: Record<string, unknown>
}

export interface EpisodicMemorySearchQuery {
  result?: EpisodicResult
  from?: number
  to?: number
  taskId?: string
  keyword?: string
  tag?: string
}

function createId(): string {
  return `em-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export class EpisodicMemory implements MemoryLayerAdapter<EpisodicMemoryStoreInput, EpisodicMemoryEntry, EpisodicMemoryEntry> {
  private entries: EpisodicMemoryEntry[] = []

  constructor(private readonly maxEntries = 50) {}

  store(input: EpisodicMemoryStoreInput): EpisodicMemoryEntry {
    const now = Date.now()
    const entry: EpisodicMemoryEntry = {
      id: input.id ?? createId(),
      taskId: input.taskId,
      summary: input.summary,
      result: input.result,
      startedAt: input.startedAt ?? now,
      endedAt: input.endedAt ?? now,
      tags: input.tags ?? [],
      metadata: input.metadata,
    }

    this.entries = [entry, ...this.entries.filter(item => item.id !== entry.id)]
      .sort((a, b) => b.endedAt - a.endedAt)
      .slice(0, this.maxEntries)

    return entry
  }

  retrieve(id: string): EpisodicMemoryEntry | undefined {
    return this.entries.find(entry => entry.id === id)
  }

  search(query: EpisodicMemorySearchQuery = {}): EpisodicMemoryEntry[] {
    const keyword = query.keyword?.toLowerCase()

    return this.entries.filter(entry => {
      if (query.result && entry.result !== query.result) return false
      if (query.taskId && entry.taskId !== query.taskId) return false
      if (query.tag && !entry.tags.includes(query.tag)) return false
      if (query.from !== undefined && entry.endedAt < query.from) return false
      if (query.to !== undefined && entry.endedAt > query.to) return false
      if (keyword) {
        const haystack = `${entry.summary} ${entry.tags.join(' ')}`.toLowerCase()
        if (!haystack.includes(keyword)) return false
      }
      return true
    })
  }

  list(): EpisodicMemoryEntry[] {
    return [...this.entries]
  }

  clear(): void {
    this.entries = []
  }
}
