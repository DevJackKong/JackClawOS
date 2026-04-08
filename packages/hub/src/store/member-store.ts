// JackClaw Hub - Member Store
// Persists to ~/.jackclaw/hub/members.json

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { Member } from '../models/tenant'

// ─── Paths / 路径 ───────────────────────────────────────────────────────────────

const HUB_DIR = path.join(process.env.HOME ?? '~', '.jackclaw', 'hub')
const MEMBERS_FILE = path.join(HUB_DIR, 'members.json')

// ─── Helpers / 辅助函数 ─────────────────────────────────────────────────────────

/**
 * Load JSON file with fallback.
 * 加载 JSON 文件；失败时返回兜底值。
 */
function loadJSON<T>(file: string, fallback: T): T {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8')) as T
  } catch {
    // ignore parse/read errors / 忽略读取或解析错误
  }
  return fallback
}

/**
 * Save JSON file, auto-create parent directory.
 * 保存 JSON 文件，并自动创建父目录。
 */
function saveJSON(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
}

// ─── MemberStore / 成员存储 ─────────────────────────────────────────────────────

export class MemberStore {
  /**
   * Load all members from disk.
   * 从磁盘加载全部成员。
   */
  private load(): Member[] {
    return loadJSON<Member[]>(MEMBERS_FILE, [])
  }

  /**
   * Persist all members to disk.
   * 将全部成员持久化到磁盘。
   */
  private save(members: Member[]): void {
    saveJSON(MEMBERS_FILE, members)
  }

  /**
   * Add a new member record.
   * 添加成员记录。
   */
  add(tenantId: string, orgId: string, userId: string, role: string): Member {
    const members = this.load()
    const now = Date.now()

    const member: Member = {
      id: crypto.randomUUID(),
      tenantId,
      orgId,
      userId,
      role,
      status: 'active',
      joinedAt: now,
      updatedAt: now,
    }

    members.push(member)
    this.save(members)
    return member
  }

  /**
   * Get one member by id.
   * 按 id 获取成员。
   */
  get(id: string): Member | null {
    return this.load().find(member => member.id === id) ?? null
  }

  /**
   * Find member by user within one tenant.
   * 在指定租户内按 userId 查成员。
   */
  getByUser(userId: string, tenantId: string): Member | null {
    return this.load().find(member => member.userId === userId && member.tenantId === tenantId) ?? null
  }

  /**
   * List all members under one organization.
   * 列出某个组织下的全部成员。
   */
  listByOrg(orgId: string): Member[] {
    return this.load()
      .filter(member => member.orgId === orgId)
      .sort((a, b) => b.joinedAt - a.joinedAt)
  }

  /**
   * List all members under one tenant.
   * 列出某个租户下的全部成员。
   */
  listByTenant(tenantId: string): Member[] {
    return this.load()
      .filter(member => member.tenantId === tenantId)
      .sort((a, b) => b.joinedAt - a.joinedAt)
  }

  /**
   * Update member role.
   * 更新成员角色。
   */
  updateRole(id: string, role: string): Member | null {
    const members = this.load()
    const member = members.find(item => item.id === id)
    if (!member) return null

    member.role = role
    member.updatedAt = Date.now()
    this.save(members)
    return member
  }

  /**
   * Remove member by id.
   * 按 id 删除成员。
   */
  remove(id: string): boolean {
    const members = this.load()
    const next = members.filter(member => member.id !== id)
    if (next.length === members.length) return false
    this.save(next)
    return true
  }
}

export const memberStore = new MemberStore()
