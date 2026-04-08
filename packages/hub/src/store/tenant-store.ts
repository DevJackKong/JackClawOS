// JackClaw Hub - Tenant Store
// Persists to ~/.jackclaw/hub/tenants.json

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { Tenant, Organization, Workspace } from '../models/tenant'

// ─── Paths / 路径 ──────────────────────────────────────────────────────────────

const HUB_DIR = path.join(process.env.HOME ?? '~', '.jackclaw', 'hub')
const TENANTS_FILE = path.join(HUB_DIR, 'tenants.json')

// ─── Types / 类型 ──────────────────────────────────────────────────────────────

export interface TenantRecord extends Tenant {
  organizations: Organization[]   // Tenant organizations / 租户下的组织
  workspaces: Workspace[]         // Tenant workspaces / 租户下的工作区
}

export interface TenantUpdates {
  name?: string
  slug?: string
  plan?: Tenant['plan']
  status?: Tenant['status']
  settings?: Record<string, unknown>
}

// ─── Helpers / 工具函数 ────────────────────────────────────────────────────────

function loadJSON<T>(file: string, fallback: T): T {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8')) as T
  } catch { /* ignore */ }
  return fallback
}

function saveJSON(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
}

function generateId(bytes = 8): string {
  return crypto.randomBytes(bytes).toString('hex')
}

// ─── TenantStore / 租户存储 ────────────────────────────────────────────────────

export class TenantStore {
  private load(): Record<string, TenantRecord> {
    return loadJSON<Record<string, TenantRecord>>(TENANTS_FILE, {})
  }

  private save(store: Record<string, TenantRecord>): void {
    saveJSON(TENANTS_FILE, store)
  }

  /**
   * Create tenant with default organization and workspace.
   * 创建租户时自动生成默认组织和默认工作区。
   */
  create(name: string, slug: string, plan: Tenant['plan']): TenantRecord {
    const store = this.load()
    const now = Date.now()
    const tenantId = generateId(12)
    const orgId = generateId(10)
    const workspaceId = generateId(10)

    const normalizedName = name.trim()
    const normalizedSlug = slug.trim().toLowerCase()

    const organization: Organization = {
      id: orgId,
      tenantId,
      name: `${normalizedName} Org`,
      slug: normalizedSlug,
      createdAt: now,
      updatedAt: now,
    }

    const workspace: Workspace = {
      id: workspaceId,
      orgId,
      tenantId,
      name: 'Default Workspace',
      slug: 'default',
      createdAt: now,
      updatedAt: now,
    }

    const tenant: TenantRecord = {
      id: tenantId,
      name: normalizedName,
      slug: normalizedSlug,
      plan,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      settings: {},
      organizations: [organization],
      workspaces: [workspace],
    }

    store[tenantId] = tenant
    this.save(store)
    return tenant
  }

  /**
   * Get tenant by id.
   * 按 id 获取租户。
   */
  get(id: string): TenantRecord | null {
    return this.load()[id] ?? null
  }

  /**
   * List all tenants.
   * 获取全部租户列表。
   */
  list(): TenantRecord[] {
    return Object.values(this.load()).sort((a, b) => b.createdAt - a.createdAt)
  }

  /**
   * Update tenant fields.
   * 更新租户基础字段。
   */
  update(id: string, updates: TenantUpdates): TenantRecord | null {
    const store = this.load()
    const tenant = store[id]
    if (!tenant) return null

    if (updates.name !== undefined) tenant.name = updates.name.trim()
    if (updates.slug !== undefined) tenant.slug = updates.slug.trim().toLowerCase()
    if (updates.plan !== undefined) tenant.plan = updates.plan
    if (updates.status !== undefined) tenant.status = updates.status
    if (updates.settings !== undefined) tenant.settings = updates.settings
    tenant.updatedAt = Date.now()

    store[id] = tenant
    this.save(store)
    return tenant
  }

  /**
   * Delete tenant from store.
   * 从存储中删除租户。
   */
  delete(id: string): boolean {
    const store = this.load()
    if (!store[id]) return false
    delete store[id]
    this.save(store)
    return true
  }
}

// Singleton / 单例
export const tenantStore = new TenantStore()
