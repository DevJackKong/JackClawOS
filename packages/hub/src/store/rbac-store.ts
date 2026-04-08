// JackClaw Hub - RBAC Store
// Persists to ~/.jackclaw/hub/rbac.json
// 角色与权限数据持久化到 ~/.jackclaw/hub/rbac.json

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { Role, RoleAssignment, RoleName } from '../models/rbac'
import { DEFAULT_ROLES } from '../models/rbac'

// ─── Paths / 路径 ──────────────────────────────────────────────────────────────

const HUB_DIR = path.join(process.env.HOME ?? '~', '.jackclaw', 'hub')
const RBAC_FILE = path.join(HUB_DIR, 'rbac.json')

// ─── Store Types / 存储结构 ───────────────────────────────────────────────────

interface RbacData {
  roles: Role[]
  assignments: RoleAssignment[]
}

// ─── Helpers / 辅助函数 ───────────────────────────────────────────────────────

function loadJSON<T>(file: string, fallback: T): T {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8')) as T
  } catch {
    // Ignore broken or missing file / 忽略文件不存在或损坏的情况
  }
  return fallback
}

function saveJSON(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`
}

/**
 * Parse a permission string like "memory:read:org" or "*" into parts.
 * 解析权限字符串为 resource / action / scope 三元组。
 */
function parsePermissionStr(perm: string): { resource: string; action: string; scope?: string } {
  if (perm === '*') return { resource: '*', action: '*' }
  const parts = perm.split(':')
  return {
    resource: parts[0] ?? '*',
    action: parts[1] ?? '*',
    scope: parts[2],
  }
}

// ─── RbacStore / 角色权限存储 ─────────────────────────────────────────────────

export class RbacStore {
  private load(): RbacData {
    return loadJSON<RbacData>(RBAC_FILE, { roles: [], assignments: [] })
  }

  private save(data: RbacData): void {
    saveJSON(RBAC_FILE, data)
  }

  /**
   * Create a custom role for a tenant / 为租户创建自定义角色
   */
  createRole(
    tenantId: string,
    name: string,
    displayName: string,
    permissions: string[],
  ): Role {
    const normalizedName = name.trim().toLowerCase()
    if (!tenantId.trim()) throw Object.assign(new Error('tenantId 不能为空'), { status: 400 })
    if (!normalizedName) throw Object.assign(new Error('角色名不能为空'), { status: 400 })

    const data = this.load()
    const exists = data.roles.find(
      role => role.tenantId === tenantId && role.name.toLowerCase() === normalizedName,
    )
    if (exists) throw Object.assign(new Error(`角色 ${normalizedName} 已存在`), { status: 409 })

    const now = Date.now()
    const deduped = [...new Set(permissions.map(p => p.trim()).filter(Boolean))]

    const role: Role = {
      id: createId('role'),
      tenantId,
      name: normalizedName as RoleName,
      displayName: displayName.trim() || normalizedName,
      permissions: deduped,
      isSystem: false,
      createdAt: now,
      updatedAt: now,
    }

    data.roles.push(role)
    this.save(data)
    return role
  }

  /**
   * Get role by id / 按角色 ID 获取角色
   */
  getRole(id: string): Role | null {
    const data = this.load()
    return data.roles.find(role => role.id === id) ?? null
  }

  /**
   * List all roles under a tenant / 列出租户下全部角色
   */
  listRoles(tenantId: string): Role[] {
    const data = this.load()
    return data.roles
      .filter(role => role.tenantId === tenantId)
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  /**
   * Assign a role to a user / 给用户授予角色
   */
  assignRole(
    userId: string,
    roleId: string,
    tenantId: string,
    orgId?: string,
    grantedBy?: string,
  ): RoleAssignment {
    const data = this.load()
    const role = data.roles.find(item => item.id === roleId && item.tenantId === tenantId)
    if (!role) throw Object.assign(new Error('角色不存在'), { status: 404 })

    const existing = data.assignments.find(a => (
      a.userId === userId
      && a.roleId === roleId
      && a.tenantId === tenantId
      && (a.orgId ?? '') === (orgId ?? '')
    ))
    if (existing) return existing

    const now = Date.now()
    const assignment: RoleAssignment = {
      id: createId('assign'),
      userId,
      roleId,
      tenantId,
      orgId,
      grantedBy: grantedBy ?? 'system',
      grantedAt: now,
      createdAt: now,
      updatedAt: now,
    }

    data.assignments.push(assignment)
    this.save(data)
    return assignment
  }

  /**
   * Get all roles assigned to a user in a tenant / 获取用户在某租户下的全部角色
   */
  getUserRoles(userId: string, tenantId: string): Role[] {
    const data = this.load()
    const roleIds = new Set(
      data.assignments
        .filter(a => a.userId === userId && a.tenantId === tenantId)
        .map(a => a.roleId),
    )
    return data.roles.filter(role => role.tenantId === tenantId && roleIds.has(role.id))
  }

  /**
   * Check whether user has permission / 检查用户是否拥有指定权限
   * Permissions are stored as strings like "memory:read:org" or "*"
   */
  checkPermission(
    userId: string,
    tenantId: string,
    resource: string,
    action: string,
  ): boolean {
    const targetResource = resource.trim()
    const targetAction = action.trim()
    const roles = this.getUserRoles(userId, tenantId)

    return roles.some(role =>
      role.permissions.some(permStr => {
        const { resource: r, action: a } = parsePermissionStr(permStr)
        const resourceMatched = r === '*' || r === targetResource
        const actionMatched = a === '*' || a === targetAction
        return resourceMatched && actionMatched
      }),
    )
  }

  /**
   * Initialize built-in default roles for a tenant.
   * 为租户初始化内置默认角色：owner/admin/manager/agent/guest/auditor
   */
  initDefaultRoles(tenantId: string): Role[] {
    const data = this.load()
    const now = Date.now()
    const created: Role[] = []

    for (const defaultRole of DEFAULT_ROLES) {
      const exists = data.roles.find(
        role => role.tenantId === tenantId && role.name === defaultRole.name,
      )
      if (exists) {
        created.push(exists)
        continue
      }

      const role: Role = {
        ...defaultRole,
        id: createId('role'),
        tenantId,
        createdAt: now,
        updatedAt: now,
      }

      data.roles.push(role)
      created.push(role)
    }

    this.save(data)
    return created
  }
}

export const rbacStore = new RbacStore()
