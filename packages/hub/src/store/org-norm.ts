/**
 * OrgNorm — 团队规范持久化存储
 * 持久化到 ~/.jackclaw/org/norms.json
 */
import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'

export interface OrgNorm {
  id: string
  title: string
  content: string
  category: string   // 'code' | 'communication' | 'process' | 'other'
  author: string
  createdAt: number
  updatedAt: number
}

const STORE_DIR = path.join(os.homedir(), '.jackclaw', 'org')
const STORE_FILE = path.join(STORE_DIR, 'norms.json')

export class OrgNormStore {
  private norms: OrgNorm[] = []

  constructor() {
    this.load()
  }

  /** Return all norms */
  list(): OrgNorm[] {
    return [...this.norms]
  }

  /** Get single norm by id */
  get(id: string): OrgNorm | undefined {
    return this.norms.find(n => n.id === id)
  }

  /** Add a new norm */
  add(input: { title: string; content: string; category?: string; author?: string }): OrgNorm {
    const validCategories = ['code', 'communication', 'process', 'other']
    const norm: OrgNorm = {
      id: crypto.randomUUID(),
      title: input.title,
      content: input.content,
      category: (input.category && validCategories.includes(input.category)) ? input.category : 'other',
      author: input.author || 'unknown',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.norms.push(norm)
    this.flush()
    return norm
  }

  /** Update an existing norm, returns updated norm or undefined */
  update(id: string, fields: Partial<Pick<OrgNorm, 'title' | 'content' | 'category' | 'author'>>): OrgNorm | undefined {
    const norm = this.norms.find(n => n.id === id)
    if (!norm) return undefined
    if (fields.title !== undefined) norm.title = fields.title
    if (fields.content !== undefined) norm.content = fields.content
    if (fields.category !== undefined) norm.category = fields.category
    if (fields.author !== undefined) norm.author = fields.author
    norm.updatedAt = Date.now()
    this.flush()
    return norm
  }

  /** Delete norm by id, returns true if found */
  delete(id: string): boolean {
    const idx = this.norms.findIndex(n => n.id === id)
    if (idx === -1) return false
    this.norms.splice(idx, 1)
    this.flush()
    return true
  }

  /**
   * Legacy compat: build system prompt inject from norms
   * Maps old scope-based filtering to category-based listing
   */
  buildSystemPromptInject(_role?: string): string {
    if (this.norms.length === 0) return ''
    const lines = this.norms.map(n => `- [${n.category}] ${n.title}: ${n.content}`).join('\n')
    return `ORGANIZATION NORMS:\n${lines}`
  }

  private load() {
    try {
      fs.mkdirSync(STORE_DIR, { recursive: true })
      const raw = fs.readFileSync(STORE_FILE, 'utf-8')
      const data = JSON.parse(raw)
      if (Array.isArray(data)) this.norms = data
    } catch {
      // file doesn't exist or invalid — start fresh
    }
  }

  private flush() {
    fs.mkdirSync(STORE_DIR, { recursive: true })
    fs.writeFileSync(STORE_FILE, JSON.stringify(this.norms, null, 2))
  }
}

// Singleton
let _store: OrgNormStore | null = null
export function getOrgNormStore(): OrgNormStore {
  if (!_store) _store = new OrgNormStore()
  return _store
}
