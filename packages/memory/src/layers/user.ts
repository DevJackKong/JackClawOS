// UserMemory — 用户记忆，持久化偏好与事实信息，支持 key-value + tag

import fs from 'fs'
import path from 'path'
import os from 'os'
import type { MemoryLayerAdapter } from './working.js'

export interface UserMemoryEntry {
  id: string
  key: string
  value: string
  tags: string[]
  createdAt: number
  updatedAt: number
  metadata?: Record<string, unknown>
}

export interface UserMemoryStoreInput {
  id?: string
  key: string
  value: string
  tags?: string[]
  metadata?: Record<string, unknown>
}

export interface UserMemorySearchQuery {
  key?: string
  tag?: string
  keyword?: string
}

function createId(): string {
  return `um-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

export class UserMemory implements MemoryLayerAdapter<UserMemoryStoreInput, UserMemoryEntry, UserMemoryEntry> {
  private readonly filePath: string
  private entries = new Map<string, UserMemoryEntry>()

  constructor(filePath = path.join(os.homedir(), '.jackclaw', 'memory', 'user-memory.json')) {
    this.filePath = filePath
    this.entries = this.load()
  }

  store(input: UserMemoryStoreInput): UserMemoryEntry {
    const now = Date.now()
    const current = [...this.entries.values()].find(entry => entry.key === input.key)
    const entry: UserMemoryEntry = {
      id: current?.id ?? input.id ?? createId(),
      key: input.key,
      value: input.value,
      tags: input.tags ?? current?.tags ?? [],
      metadata: input.metadata ?? current?.metadata,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    }

    this.entries.set(entry.id, entry)
    this.persist()
    return entry
  }

  retrieve(id: string): UserMemoryEntry | undefined {
    return this.entries.get(id)
  }

  search(query: UserMemorySearchQuery = {}): UserMemoryEntry[] {
    const keyword = query.keyword?.toLowerCase()

    return this.list().filter(entry => {
      if (query.key && entry.key !== query.key) return false
      if (query.tag && !entry.tags.includes(query.tag)) return false
      if (keyword) {
        const haystack = `${entry.key} ${entry.value} ${entry.tags.join(' ')}`.toLowerCase()
        if (!haystack.includes(keyword)) return false
      }
      return true
    })
  }

  list(): UserMemoryEntry[] {
    return [...this.entries.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  clear(): void {
    this.entries.clear()
    this.persist()
  }

  private load(): Map<string, UserMemoryEntry> {
    if (!fs.existsSync(this.filePath)) {
      return new Map()
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8')
      const entries = JSON.parse(raw) as UserMemoryEntry[]
      return new Map(entries.map(entry => [entry.id, entry]))
    } catch {
      return new Map()
    }
  }

  private persist(): void {
    ensureDir(this.filePath)
    fs.writeFileSync(this.filePath, JSON.stringify(this.list(), null, 2), 'utf-8')
  }
}
