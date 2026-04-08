// JackClaw Hub - Organization Store
// Persists to ~/.jackclaw/hub/organizations.json

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { Organization } from '../models/tenant'

// ─── Paths / 路径 ───────────────────────────────────────────────────────────────

const HUB_DIR = path.join(process.env.HOME ?? '~', '.jackclaw', 'hub')
const ORGS_FILE = path.join(HUB_DIR, 'organizations.json')

// ─── Helpers / 工具函数 ─────────────────────────────────────────────────────────

/**
 * Load JSON file with fallback value.
 * 读取 JSON 文件；若不存在或损坏则返回兜底值。
 */
function loadJSON<T>(file: string, fallback: T): T {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8')) as T
  } catch {
    // ignore invalid JSON / 忽略损坏 JSON
  }
  return fallback
}

/**
 * Save JSON file to disk.
 * 保存 JSON 文件到磁盘。
 */
function saveJSON(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
}

// ─── OrgStore / 组织存储 ───────────────────────────────────────────────────────

export class OrgStore {
  /**
   * Load all organizations keyed by id.
   * 按 id 加载全部组织记录。
   */
  private load(): Record<string, Organization> {
    return loadJSON<Record<string, Organization>>(ORGS_FILE, {})
  }

  /**
   * Persist organization store.
   * 持久化组织存储。
   */
  private save(store: Record<string, Organization>): void {
    saveJSON(ORGS_FILE, store)
  }

  /**
   * Create a new organization.
   * 创建新组织。
   */
  create(tenantId: string, name: string, slug: string): Organization {
    const store = this.load()
    const now = Date.now()
    const id = crypto.randomUUID()

    const org: Organization = {
      id,
      tenantId: tenantId.trim(),
      name: name.trim(),
      slug: slug.trim(),
      createdAt: now,
      updatedAt: now,
    }

    store[id] = org
    this.save(store)
    return org
  }

  /**
   * Get organization by id.
   * 按 id 获取组织。
   */
  get(id: string): Organization | null {
    const org = this.load()[id]
    return org ?? null
  }

  /**
   * List organizations under one tenant.
   * 列出某个租户下的所有组织。
   */
  listByTenant(tenantId: string): Organization[] {
    return Object.values(this.load())
      .filter(org => org.tenantId === tenantId)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  /**
   * Update organization fields.
   * 更新组织字段。
   */
  update(id: string, updates: Partial<Pick<Organization, 'name' | 'slug'>>): Organization | null {
    const store = this.load()
    const org = store[id]
    if (!org) return null

    if (updates.name !== undefined) org.name = updates.name.trim()
    if (updates.slug !== undefined) org.slug = updates.slug.trim()
    org.updatedAt = Date.now()

    store[id] = org
    this.save(store)
    return org
  }

  /**
   * Delete organization by id.
   * 按 id 删除组织。
   */
  delete(id: string): boolean {
    const store = this.load()
    if (!(id in store)) return false

    delete store[id]
    this.save(store)
    return true
  }
}

// Singleton / 单例导出
export const orgStore = new OrgStore()
