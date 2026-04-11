// ProceduralMemory — 程序性记忆，保存 SOP 与可演化模板

import type { MemoryLayerAdapter } from './working.js'

export interface ProceduralMemoryEntry {
  id: string
  name: string
  description: string
  steps: string[]
  triggers: string[]
  tags: string[]
  version: number
  createdAt: number
  updatedAt: number
  metadata?: Record<string, unknown>
}

export interface ProceduralMemoryStoreInput {
  id?: string
  name: string
  description: string
  steps: string[]
  triggers?: string[]
  tags?: string[]
  metadata?: Record<string, unknown>
}

export interface ProceduralMemorySearchQuery {
  tag?: string
  trigger?: string
  keyword?: string
}

function createId(): string {
  return `pm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export class ProceduralMemory implements MemoryLayerAdapter<ProceduralMemoryStoreInput, ProceduralMemoryEntry, ProceduralMemoryEntry> {
  private entries = new Map<string, ProceduralMemoryEntry>()

  store(input: ProceduralMemoryStoreInput): ProceduralMemoryEntry {
    return this.register(input)
  }

  retrieve(id: string): ProceduralMemoryEntry | undefined {
    return this.entries.get(id)
  }

  search(query: ProceduralMemorySearchQuery = {}): ProceduralMemoryEntry[] {
    const keyword = query.keyword?.toLowerCase()

    return this.list().filter(entry => {
      if (query.tag && !entry.tags.includes(query.tag)) return false
      if (query.trigger && !entry.triggers.includes(query.trigger)) return false
      if (keyword) {
        const haystack = [entry.name, entry.description, ...entry.steps, ...entry.tags, ...entry.triggers]
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(keyword)) return false
      }
      return true
    })
  }

  list(): ProceduralMemoryEntry[] {
    return [...this.entries.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  clear(): void {
    this.entries.clear()
  }

  register(input: ProceduralMemoryStoreInput): ProceduralMemoryEntry {
    const now = Date.now()
    const current = [...this.entries.values()].find(entry => entry.name === input.name)
    const entry: ProceduralMemoryEntry = {
      id: current?.id ?? input.id ?? createId(),
      name: input.name,
      description: input.description,
      steps: [...input.steps],
      triggers: input.triggers ?? current?.triggers ?? [],
      tags: input.tags ?? current?.tags ?? [],
      version: current ? current.version + 1 : 1,
      metadata: input.metadata ?? current?.metadata,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    }

    this.entries.set(entry.id, entry)
    return entry
  }

  lookup(query: string): ProceduralMemoryEntry[] {
    const normalized = query.toLowerCase()
    return this.search({ keyword: normalized })
  }

  evolve(id: string, patch: Partial<Omit<ProceduralMemoryStoreInput, 'id'>>): ProceduralMemoryEntry | undefined {
    const current = this.entries.get(id)
    if (!current) return undefined

    return this.register({
      id: current.id,
      name: patch.name ?? current.name,
      description: patch.description ?? current.description,
      steps: patch.steps ?? current.steps,
      triggers: patch.triggers ?? current.triggers,
      tags: patch.tags ?? current.tags,
      metadata: patch.metadata ?? current.metadata,
    })
  }
}
