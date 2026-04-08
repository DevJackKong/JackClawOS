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
const rbac_helpers_1 = require("./rbac-helpers");
const router = (0, express_1.Router)();
function parseUnreadOnly(value) {
    if (typeof value === 'boolean')
        return value;
    if (typeof value !== 'string')
        return false;
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}
function parseLimit(value) {
    if (typeof value !== 'string')
        return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return undefined;
    return Math.floor(parsed);
}
/**
 * GET / — SECURITY: userId bound from JWT, ignore query.userId
 */
router.get('/', (0, server_1.asyncHandler)(async (req, res) => {
    const userId = (0, rbac_helpers_1.getRequester)(req);
    if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    const unreadOnly = parseUnreadOnly(req.query.unreadOnly);
    const limit = parseLimit(req.query.limit);
    const notifications = notification_store_1.notificationStore.listByUser(userId, { unreadOnly, limit });
    res.json({ userId, unreadOnly, limit, notifications, count: notifications.length });
}));
/**
 * GET /unread-count — SECURITY: userId from JWT
 */
router.get('/unread-count', (0, server_1.asyncHandler)(async (req, res) => {
    const userId = (0, rbac_helpers_1.getRequester)(req);
    if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    const unreadCount = notification_store_1.notificationStore.unreadCount(userId);
    res.json({ userId, unreadCount });
}));
/**
 * POST /read-all — SECURITY: userId from JWT
 */
router.post('/read-all', (0, server_1.asyncHandler)(async (req, res) => {
    const userId = (0, rbac_helpers_1.getRequester)(req);
    if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    const updatedCount = notification_store_1.notificationStore.markAllRead(userId);
    res.json({ userId, updatedCount });
}));
/**
 * GET /:id — SECURITY: verify notification belongs to requester
 */
router.get('/:id', (0, server_1.asyncHandler)(async (req, res) => {
    const userId = (0, rbac_helpers_1.getRequester)(req);
    if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    const id = req.params.id.trim();
    const notification = notification_store_1.notificationStore.get(id);
    if (!notification) {
        res.status(404).json({ error: 'Notification not found' });
        return;
    }
    // SECURITY: only the owner can view their notification
    if (notification.userId && notification.userId !== userId) {
        res.status(403).json({ error: 'Forbidden — not your notification' });
        return;
    }
    res.json(notification);
}));
/**
 * POST /:id/read — SECURITY: verify notification belongs to requester
 */
router.post('/:id/read', (0, server_1.asyncHandler)(async (req, res) => {
    const userId = (0, rbac_helpers_1.getRequester)(req);
    if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    const id = req.params.id.trim();
    const notification = notification_store_1.notificationStore.get(id);
    if (notification && notification.userId && notification.userId !== userId) {
        res.status(403).json({ error: 'Forbidden — not your notification' });
        return;
    }
    const result = notification_store_1.notificationStore.markRead(id);
    res.json(result);
}));
exports.default = router;
//# sourceMappingURL=notifications.js.map