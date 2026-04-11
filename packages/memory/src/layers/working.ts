// WorkingMemory — 工作记忆，单任务范围，支持 TTL 自动过期

export interface MemoryLayerAdapter<TStore, TRetrieve = TStore, TSearch = TStore> {
  store(input: TStore): TSearch
  retrieve(id: string): TRetrieve | undefined
  search(query?: unknown): TSearch[]
  list(): TSearch[]
  clear(): void
}

export interface WorkingMemoryEntry {
  id: string
  taskId: string
  content: string
  tags: string[]
  createdAt: number
  updatedAt: number
  expiresAt: number
  metadata?: Record<string, unknown>
}

export interface WorkingMemoryStoreInput {
  id?: string
  taskId: string
  content: string
  ttlMs?: number
  tags?: string[]
  metadata?: Record<string, unknown>
}

export interface WorkingMemorySearchQuery {
  taskId?: string
  tag?: string
  keyword?: string
  activeOnly?: boolean
}

function createId(): string {
  return `wm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export class WorkingMemory implements MemoryLayerAdapter<WorkingMemoryStoreInput, WorkingMemoryEntry, WorkingMemoryEntry> {
  private entries = new Map<string, WorkingMemoryEntry>()
  private timer: ReturnType<typeof setInterval>

  constructor(
    private readonly defaultTaskId = 'default-task',
    private readonly defaultTtlMs = 15 * 60 * 1000,
    cleanupIntervalMs = 30 * 1000,
  ) {
    this.timer = setInterval(() => this.cleanupExpired(), cleanupIntervalMs)
  }

  store(input: WorkingMemoryStoreInput): WorkingMemoryEntry {
    const now = Date.now()
    const ttlMs = Math.max(1, input.ttlMs ?? this.defaultTtlMs)
    const id = input.id ?? createId()
    const prev = this.entries.get(id)

    const entry: WorkingMemoryEntry = {
      id,
      taskId: input.taskId || this.defaultTaskId,
      content: input.content,
      tags: input.tags ?? [],
      metadata: input.metadata,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      expiresAt: now + ttlMs,
    }

    this.entries.set(id, entry)
    return entry
  }

  retrieve(id: string): WorkingMemoryEntry | undefined {
    const entry = this.entries.get(id)
    if (!entry) return undefined
    if (this.isExpired(entry)) {
      this.entries.delete(id)
      return undefined
    }
    return entry
  }

  search(query: WorkingMemorySearchQuery = {}): WorkingMemoryEntry[] {
    this.cleanupExpired()
    const keyword = query.keyword?.toLowerCase()

    return this.list().filter(entry => {
      if (query.taskId && entry.taskId !== query.taskId) return false
      if (query.tag && !entry.tags.includes(query.tag)) return false
      if (query.activeOnly && this.isExpired(entry)) return false
      if (keyword) {
        const haystack = `${entry.content} ${entry.tags.join(' ')}`.toLowerCase()
        if (!haystack.includes(keyword)) return false
      }
      return true
    })
  }

  list(): WorkingMemoryEntry[] {
    this.cleanupExpired()
    return [...this.entries.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  clear(): void {
    this.entries.clear()
  }

  destroy(): void {
    clearInterval(this.timer)
    this.clear()
  }

  private cleanupExpired(): void {
    for (const [id, entry] of this.entries) {
      if (this.isExpired(entry)) {
        this.entries.delete(id)
      }
    }
  }

  private isExpired(entry: WorkingMemoryEntry): boolean {
    return Date.now() > entry.expiresAt
  }
}
