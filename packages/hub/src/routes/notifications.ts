/**
 * /api/notifications — Notification routes / 通知路由
 *
 * GET  /api/notifications               — List notifications / 列出通知
 * GET  /api/notifications/unread-count  — Get unread count / 获取未读数
 * POST /api/notifications/read-all      — Mark all as read / 全部标记已读
 * GET  /api/notifications/:id           — Get one notification / 获取单个通知
 * POST /api/notifications/:id/read      — Mark one as read / 标记单条为已读
 */

import { Router, Request, Response } from 'express'
import { notificationStore } from '../store/notification-store'
import { asyncHandler } from '../server'
import { getRequester } from './rbac-helpers'

const router = Router()

function parseUnreadOnly(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return false
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

function parseLimit(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return Math.floor(parsed)
}

/**
 * GET / — SECURITY: userId bound from JWT, ignore query.userId
 */
router.get('/', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const userId = getRequester(req)
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return }

  const unreadOnly = parseUnreadOnly(req.query.unreadOnly)
  const limit = parseLimit(req.query.limit)
  const notifications = notificationStore.listByUser(userId, { unreadOnly, limit })

  res.json({ userId, unreadOnly, limit, notifications, count: notifications.length })
}))

/**
 * GET /unread-count — SECURITY: userId from JWT
 */
router.get('/unread-count', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const userId = getRequester(req)
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return }

  const unreadCount = notificationStore.unreadCount(userId)
  res.json({ userId, unreadCount })
}))

/**
 * POST /read-all — SECURITY: userId from JWT
 */
router.post('/read-all', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const userId = getRequester(req)
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return }

  const updatedCount = notificationStore.markAllRead(userId)
  res.json({ userId, updatedCount })
}))

/**
 * GET /:id — SECURITY: verify notification belongs to requester
 */
router.get('/:id', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const userId = getRequester(req)
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return }

  const id = req.params.id.trim()
  const notification = notificationStore.get(id)

  if (!notification) {
    res.status(404).json({ error: 'Notification not found' })
    return
  }

  // SECURITY: only the owner can view their notification
  if ((notification as any).userId && (notification as any).userId !== userId) {
    res.status(403).json({ error: 'Forbidden — not your notification' })
    return
  }

  res.json(notification)
}))

/**
 * POST /:id/read — SECURITY: verify notification belongs to requester
 */
router.post('/:id/read', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const userId = getRequester(req)
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return }

  const id = req.params.id.trim()
  const notification = notificationStore.get(id)

  if (notification && (notification as any).userId && (notification as any).userId !== userId) {
    res.status(403).json({ error: 'Forbidden — not your notification' })
    return
  }

  const result = notificationStore.markRead(id)
  res.json(result)
}))

export default router
