// JackClaw Hub - Workspace Store
// Persists to ~/.jackclaw/hub/workspaces.json

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { Workspace } from '../models/tenant'

// 存储目录 / Storage directory
const HUB_DIR = path.join(process.env.HOME ?? '~', '.jackclaw', 'hub')
const WORKSPACES_FILE = path.join(HUB_DIR, 'workspaces.json')

// 读取 JSON 文件，不存在或损坏时返回默认值
// Read JSON file, return fallback if missing or invalid
function loadJSON<T>(file: string, fallback: T): T {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8')) as T
  } catch {
    // ignore parse/read errors
  }
  return fallback
}

// 保存 JSON 文件，自动创建目录
// Save JSON file and create parent directory automatically
function saveJSON(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
}

export class WorkspaceStore {
  // 加载全部 workspace，内部以 id 为 key
  // Load all workspaces keyed by id
  private load(): Record<string, Workspace> {
    return loadJSON<Record<string, Workspace>>(WORKSPACES_FILE, {})
  }

  // 持久化全部 workspace
  // Persist all workspaces to disk
  private save(store: Record<string, Workspace>): void {
    saveJSON(WORKSPACES_FILE, store)
  }

  // 创建 workspace，自动生成 id 与时间戳
  // Create workspace with auto-generated id and timestamps
  create(orgId: string, tenantId: string, name: string, slug: string): Workspace {
    const store = this.load()
    const now = Date.now()
    const workspace: Workspace = {
      id: crypto.randomUUID(),
      orgId,
      tenantId,
      name: name.trim(),
      slug: slug.trim(),
      createdAt: now,
      updatedAt: now,
    }

    store[workspace.id] = workspace
    this.save(store)
    return workspace
  }

  // 按 id 获取单个 workspace
  // Get one workspace by id
  get(id: string): Workspace | null {
    return this.load()[id] ?? null
  }

  // 获取某个组织下的全部 workspace
  // List all workspaces under one organization
  listByOrg(orgId: string): Workspace[] {
    return Object.values(this.load())
      .filter(workspace => workspace.orgId === orgId)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  // 获取某个租户下的全部 workspace
  // List all workspaces under one tenant
  listByTenant(tenantId: string): Workspace[] {
    return Object.values(this.load())
      .filter(workspace => workspace.tenantId === tenantId)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  // 更新 workspace，返回更新后的对象；不存在返回 null
  // Update workspace and return updated object; return null if not found
  update(
    id: string,
    updates: Partial<Pick<Workspace, 'orgId' | 'tenantId' | 'name' | 'slug'>>,
  ): Workspace | null {
    const store = this.load()
    const workspace = store[id]
    if (!workspace) return null

    if (updates.orgId !== undefined) workspace.orgId = updates.orgId
    if (updates.tenantId !== undefined) workspace.tenantId = updates.tenantId
    if (updates.name !== undefined) workspace.name = updates.name.trim()
    if (updates.slug !== undefined) workspace.slug = updates.slug.trim()
    workspace.updatedAt = Date.now()

    store[id] = workspace
    this.save(store)
    return workspace
  }

  // 删除 workspace，成功返回 true，不存在返回 false
  // Delete workspace, return true if deleted, false if not found
  delete(id: string): boolean {
    const store = this.load()
    if (!(id in store)) return false

    delete store[id]
    this.save(store)
    return true
  }
}

// 单例导出 / Singleton export
export const workspaceStore = new WorkspaceStore()
