"use strict";
/**
 * /api/notifications — Notification routes / 通知路由
 *
 * GET  /api/notifications               — List notifications / 列出通知
 * GET  /api/notifications/unread-count  — Get unread count / 获取未读数
 * POST /api/notifications/read-all      — Mark all as read / 全部标记已读
 * GET  /api/notifications/:id           — Get one notification / 获取单个通知
 * POST /api/notifications/:id/read      — Mark one as read / 标记单条为已读
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const notification_store_1 = require("../store/notification-store");
const server_1 = require("../server");
const router = (0, express_1.Router)();
/**
 * Parse unreadOnly query into boolean.
 * 将 unreadOnly 查询参数解析为布尔值。
 */
function parseUnreadOnly(value) {
    if (typeof value === 'boolean')
        return value;
    if (typeof value !== 'string')
        return false;
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}
/**
 * Parse limit query into positive integer.
 * 将 limit 查询参数解析为正整数。
 */
function parseLimit(value) {
    if (typeof value !== 'string')
        return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return undefined;
    return Math.floor(parsed);
}
/**
 * GET /
 * List notifications of one user.
 * 列出指定用户的通知。
 *
 * Query:
 * - userId: string
 * - unreadOnly?: boolean
 * - limit?: number
 */
router.get('/', (0, server_1.asyncHandler)(async (req, res) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
    const unreadOnly = parseUnreadOnly(req.query.unreadOnly);
    const limit = parseLimit(req.query.limit);
    if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
    }
    const notifications = notification_store_1.notificationStore.listByUser(userId, { unreadOnly, limit });
    res.json({
        userId,
        unreadOnly,
        limit,
        notifications,
        count: notifications.length,
    });
}));
/**
 * GET /unread-count
 * Get unread notification count of one user.
 * 获取指定用户的未读通知数量。
 *
 * Must be declared before /:id.
 * 必须定义在 /:id 前面。
 *
 * Query:
 * - userId: string
 */
router.get('/unread-count', (0, server_1.asyncHandler)(async (req, res) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
    if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
    }
    const unreadCount = notification_store_1.notificationStore.unreadCount(userId);
    res.json({ userId, unreadCount });
}));
/**
 * POST /read-all
 * Mark all notifications as read for one user.
 * 将指定用户的全部通知标记为已读。
 *
 * Must be declared before /:id.
 * 必须定义在 /:id 前面。
 *
 * Body:
 * - userId: string
 */
router.post('/read-all', (0, server_1.asyncHandler)(async (req, res) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
    }
    const updatedCount = notification_store_1.notificationStore.markAllRead(userId);
    res.json({ userId, updatedCount });
}));
/**
 * GET /:id
 * Get one notification by id.
 * 按 id 获取单条通知。
 */
router.get('/:id', (0, server_1.asyncHandler)(async (req, res) => {
    const id = req.params.id.trim();
    const notification = notification_store_1.notificationStore.get(id);
    if (!notification) {
        res.status(404).json({ error: 'Notification not found' });
        return;
    }
    res.json(notification);
}));
/**
 * POST /:id/read
 * Mark one notification as read.
 * 将单条通知标记为已读。
 */
router.post('/:id/read', (0, server_1.asyncHandler)(async (req, res) => {
    const id = req.params.id.trim();
    const notification = notification_store_1.notificationStore.markRead(id);
    res.json(notification);
}));
exports.default = router;
//# sourceMappingURL=notifications.js.map