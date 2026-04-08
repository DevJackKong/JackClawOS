// JackClaw Hub - Notification Store
// Persists to ~/.jackclaw/hub/notifications.json
// 通知记录持久化到 ~/.jackclaw/hub/notifications.json

import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'

const HUB_DIR = path.join(os.homedir(), '.jackclaw', 'hub')
const NOTIFICATIONS_FILE = path.join(HUB_DIR, 'notifications.json')

export interface Notification {
  id: string
  tenantId: string
  userId: string
  type: 'info' | 'warning' | 'error' | 'success' | 'task' | 'approval' | 'system'
  title: string
  body?: string
  link?: string
  read: boolean
  metadata?: Record<string, unknown>
  createdAt: number
}

/**
 * Read JSON file with fallback value.
 * 读取 JSON 文件；不存在或损坏时返回兜底值。
 */
function loadJSON<T>(file: string, fallback: T): T {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8')) as T
    }
  } catch {
    // Ignore missing/invalid file.
    // 忽略文件缺失或 JSON 损坏。
  }
  return fallback
}

/**
 * Save JSON file and create parent directory automatically.
 * 保存 JSON 文件，并自动创建父目录。
 */
function saveJSON(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
}

/**
 * Normalize one notification record loaded from disk.
 * 标准化磁盘中读取的单条通知记录。
 */
function normalizeNotification(input: Partial<Notification>): Notification | null {
  const id = String(input.id ?? '').trim()
  const tenantId = String(input.tenantId ?? '').trim()
  const userId = String(input.userId ?? '').trim()
  const title = String(input.title ?? '').trim()

  if (!id || !tenantId || !userId || !title) return null

  return {
    id,
    tenantId,
    userId,
    type: (input.type ?? 'info') as Notification['type'],
    title,
    body: typeof input.body === 'string' ? input.body : undefined,
    link: typeof input.link === 'string' ? input.link : undefined,
    read: input.read === true,
    metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
      ? input.metadata
      : undefined,
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt as number : Date.now(),
  }
}

/**
 * JSON-file-backed notification store.
 * 基于 JSON 文件的通知存储。
 */
export class NotificationStore {
  private readonly file: string

  constructor(file = NOTIFICATIONS_FILE) {
    this.file = file
  }

  /**
   * Load all notifications from disk.
   * 从磁盘加载全部通知。
   */
  private load(): Notification[] {
    const items = loadJSON<Partial<Notification>[]>(this.file, [])
    return items
      .map(normalizeNotification)
      .filter((item): item is Notification => item !== null)
  }

  /**
   * Persist all notifications to disk.
   * 将全部通知持久化到磁盘。
   */
  private save(items: Notification[]): void {
    saveJSON(this.file, items)
  }

  /**
   * Create one notification.
   * 创建一条通知。
   */
  create(
    tenantId: string,
    userId: string,
    type: Notification['type'],
    title: string,
    opts: Partial<Notification> = {},
  ): Notification {
    const notifications = this.load()
    const now = Date.now()

    const notification: Notification = {
      id: opts.id?.trim() || crypto.randomUUID(),
      tenantId: tenantId.trim(),
      userId: userId.trim(),
      type,
      title: title.trim(),
      body: typeof opts.body === 'string' ? opts.body : undefined,
      link: typeof opts.link === 'string' ? opts.link : undefined,
      read: opts.read === true,
      metadata: opts.metadata && typeof opts.metadata === 'object' && !Array.isArray(opts.metadata)
        ? opts.metadata
        : undefined,
      createdAt: typeof opts.createdAt === 'number' && Number.isFinite(opts.createdAt) ? opts.createdAt : now,
    }

    if (!notification.tenantId) throw Object.assign(new Error('tenantId 不能为空'), { status: 400 })
    if (!notification.userId) throw Object.assign(new Error('userId 不能为空'), { status: 400 })
    if (!notification.title) throw Object.assign(new Error('title 不能为空'), { status: 400 })

    if (notifications.some(item => item.id === notification.id)) {
      throw Object.assign(new Error(`notification ${notification.id} 已存在`), { status: 409 })
    }

    notifications.push(notification)
    this.save(notifications)
    return notification
  }

  /**
   * Get one notification by id.
   * 按 id 获取单条通知。
   */
  get(id: string): Notification | null {
    return this.load().find(item => item.id === id) ?? null
  }

  /**
   * List notifications for one user.
   * 按用户列出通知。
   */
  listByUser(userId: string, opts: { unreadOnly?: boolean; limit?: number } = {}): Notification[] {
    const normalizedUserId = userId.trim()
    const unreadOnly = opts.unreadOnly === true
    const limit = typeof opts.limit === 'number' && Number.isFinite(opts.limit) && opts.limit > 0
      ? Math.floor(opts.limit)
      : undefined

    const items = this.load()
      .filter(item => item.userId === normalizedUserId)
      .filter(item => (unreadOnly ? !item.read : true))
      .sort((a, b) => b.createdAt - a.createdAt)

    return limit ? items.slice(0, limit) : items
  }

  /**
   * Mark one notification as read.
   * 将单条通知标记为已读。
   */
  markRead(id: string): Notification {
    const notifications = this.load()
    const notification = notifications.find(item => item.id === id)

    if (!notification) {
      throw Object.assign(new Error(`notification ${id} 不存在`), { status: 404 })
    }

    notification.read = true
    this.save(notifications)
    return notification
  }

  /**
   * Mark all notifications of one user as read.
   * 将某个用户的全部通知标记为已读。
   */
  markAllRead(userId: string): number {
    const normalizedUserId = userId.trim()
    const notifications = this.load()
    let count = 0

    for (const item of notifications) {
      if (item.userId === normalizedUserId && !item.read) {
        item.read = true
        count += 1
      }
    }

    if (count > 0) this.save(notifications)
    return count
  }

  /**
   * Count unread notifications of one user.
   * 统计某个用户的未读通知数。
   */
  unreadCount(userId: string): number {
    const normalizedUserId = userId.trim()
    return this.load().filter(item => item.userId === normalizedUserId && !item.read).length
  }

  /**
   * Delete one notification by id.
   * 按 id 删除一条通知。
   */
  delete(id: string): boolean {
    const notifications = this.load()
    const next = notifications.filter(item => item.id !== id)

    if (next.length === notifications.length) return false

    this.save(next)
    return true
  }
}

export const notificationStore = new NotificationStore()

export default notificationStore
