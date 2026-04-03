/**
 * OrgMemory — 组织级共享记忆（Hub 存储，所有 Node 可读）
 * 持久化到 ~/.jackclaw/org/memory.json
 */
import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'

export type OrgMemoryType = 'lesson' | 'decision' | 'feedback' | 'milestone'

export interface OrgMemEntry {
  id: string
  type: OrgMemoryType
  content: string
  nodeId: string
  tags: string[]
  createdAt: number
}

// Keep legacy alias so existing imports of OrgMemoryType still compile
export type { OrgMemoryType as OrgMemoryTypeCompat }

const STORE_DIR = path.join(os.homedir(), '.jackclaw', 'org')
const STORE_FILE = path.join(STORE_DIR, 'memory.json')

export class OrgMemoryStore {
  private entries: OrgMemEntry[] = []

  constructor() {
    this.load()
  }

  /** Return all entries (newest first) */
  list(): OrgMemEntry[] {
    return [...this.entries].reverse()
  }

  /** Query with optional type filter and limit */
  query(type?: OrgMemoryType, limit = 20): OrgMemEntry[] {
    return this.entries
      .filter(e => !type || e.type === type)
      .slice(-limit)
      .reverse()
  }

  /** Get single entry by id */
  get(id: string): OrgMemEntry | undefined {
    return this.entries.find(e => e.id === id)
  }

  /** Keyword search (case-insensitive includes on content + tags) */
  search(query: string): OrgMemEntry[] {
    const q = query.toLowerCase()
    return this.entries.filter(e =>
      e.content.toLowerCase().includes(q) ||
      e.tags.some(t => t.toLowerCase().includes(q))
    )
  }

  /** Add a new entry */
  add(input: { type: OrgMemoryType; content: string; nodeId: string; tags?: string[] }): OrgMemEntry {
    const entry: OrgMemEntry = {
      id: crypto.randomUUID(),
      type: input.type,
      content: input.content,
      nodeId: input.nodeId,
      tags: Array.isArray(input.tags) ? input.tags : [],
      createdAt: Date.now(),
    }
    this.entries.push(entry)
    if (this.entries.length > 500) this.entries.splice(0, this.entries.length - 500)
    this.flush()
    return entry
  }

  /** Delete entry by id, returns true if found */
  delete(id: string): boolean {
    const idx = this.entries.findIndex(e => e.id === id)
    if (idx === -1) return false
    this.entries.splice(idx, 1)
    this.flush()
    return true
  }

  private load() {
    try {
      fs.mkdirSync(STORE_DIR, { recursive: true })
      const raw = fs.readFileSync(STORE_FILE, 'utf-8')
      const data = JSON.parse(raw)
      if (Array.isArray(data)) this.entries = data
    } catch {
      // file doesn't exist or invalid — start fresh
    }
  }

  private flush() {
    fs.mkdirSync(STORE_DIR, { recursive: true })
    fs.writeFileSync(STORE_FILE, JSON.stringify(this.entries, null, 2))
  }
}
