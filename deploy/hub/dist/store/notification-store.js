"use strict";
// JackClaw Hub - Notification Store
// Persists to ~/.jackclaw/hub/notifications.json
// 通知记录持久化到 ~/.jackclaw/hub/notifications.json
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationStore = exports.NotificationStore = void 0;
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const HUB_DIR = path_1.default.join(os_1.default.homedir(), '.jackclaw', 'hub');
const NOTIFICATIONS_FILE = path_1.default.join(HUB_DIR, 'notifications.json');
/**
 * Read JSON file with fallback value.
 * 读取 JSON 文件；不存在或损坏时返回兜底值。
 */
function loadJSON(file, fallback) {
    try {
        if (fs_1.default.existsSync(file)) {
            return JSON.parse(fs_1.default.readFileSync(file, 'utf-8'));
        }
    }
    catch {
        // Ignore missing/invalid file.
        // 忽略文件缺失或 JSON 损坏。
    }
    return fallback;
}
/**
 * Save JSON file and create parent directory automatically.
 * 保存 JSON 文件，并自动创建父目录。
 */
function saveJSON(file, data) {
    fs_1.default.mkdirSync(path_1.default.dirname(file), { recursive: true });
    fs_1.default.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}
/**
 * Normalize one notification record loaded from disk.
 * 标准化磁盘中读取的单条通知记录。
 */
function normalizeNotification(input) {
    const id = String(input.id ?? '').trim();
    const tenantId = String(input.tenantId ?? '').trim();
    const userId = String(input.userId ?? '').trim();
    const title = String(input.title ?? '').trim();
    if (!id || !tenantId || !userId || !title)
        return null;
    return {
        id,
        tenantId,
        userId,
        type: (input.type ?? 'info'),
        title,
        body: typeof input.body === 'string' ? input.body : undefined,
        link: typeof input.link === 'string' ? input.link : undefined,
        read: input.read === true,
        metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
            ? input.metadata
            : undefined,
        createdAt: Number.isFinite(input.createdAt) ? input.createdAt : Date.now(),
    };
}
/**
 * JSON-file-backed notification store.
 * 基于 JSON 文件的通知存储。
 */
class NotificationStore {
    file;
    constructor(file = NOTIFICATIONS_FILE) {
        this.file = file;
    }
    /**
     * Load all notifications from disk.
     * 从磁盘加载全部通知。
     */
    load() {
        const items = loadJSON(this.file, []);
        return items
            .map(normalizeNotification)
            .filter((item) => item !== null);
    }
    /**
     * Persist all notifications to disk.
     * 将全部通知持久化到磁盘。
     */
    save(items) {
        saveJSON(this.file, items);
    }
    /**
     * Create one notification.
     * 创建一条通知。
     */
    create(tenantId, userId, type, title, opts = {}) {
        const notifications = this.load();
        const now = Date.now();
        const notification = {
            id: opts.id?.trim() || crypto_1.default.randomUUID(),
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
        };
        if (!notification.tenantId)
            throw Object.assign(new Error('tenantId 不能为空'), { status: 400 });
        if (!notification.userId)
            throw Object.assign(new Error('userId 不能为空'), { status: 400 });
        if (!notification.title)
            throw Object.assign(new Error('title 不能为空'), { status: 400 });
        if (notifications.some(item => item.id === notification.id)) {
            throw Object.assign(new Error(`notification ${notification.id} 已存在`), { status: 409 });
        }
        notifications.push(notification);
        this.save(notifications);
        return notification;
    }
    /**
     * Get one notification by id.
     * 按 id 获取单条通知。
     */
    get(id) {
        return this.load().find(item => item.id === id) ?? null;
    }
    /**
     * List notifications for one user.
     * 按用户列出通知。
     */
    listByUser(userId, opts = {}) {
        const normalizedUserId = userId.trim();
        const unreadOnly = opts.unreadOnly === true;
        const limit = typeof opts.limit === 'number' && Number.isFinite(opts.limit) && opts.limit > 0
            ? Math.floor(opts.limit)
            : undefined;
        const items = this.load()
            .filter(item => item.userId === normalizedUserId)
            .filter(item => (unreadOnly ? !item.read : true))
            .sort((a, b) => b.createdAt - a.createdAt);
        return limit ? items.slice(0, limit) : items;
    }
    /**
     * Mark one notification as read.
     * 将单条通知标记为已读。
     */
    markRead(id) {
        const notifications = this.load();
        const notification = notifications.find(item => item.id === id);
        if (!notification) {
            throw Object.assign(new Error(`notification ${id} 不存在`), { status: 404 });
        }
        notification.read = true;
        this.save(notifications);
        return notification;
    }
    /**
     * Mark all notifications of one user as read.
     * 将某个用户的全部通知标记为已读。
     */
    markAllRead(userId) {
        const normalizedUserId = userId.trim();
        const notifications = this.load();
        let count = 0;
        for (const item of notifications) {
            if (item.userId === normalizedUserId && !item.read) {
                item.read = true;
                count += 1;
            }
        }
        if (count > 0)
            this.save(notifications);
        return count;
    }
    /**
     * Count unread notifications of one user.
     * 统计某个用户的未读通知数。
     */
    unreadCount(userId) {
        const normalizedUserId = userId.trim();
        return this.load().filter(item => item.userId === normalizedUserId && !item.read).length;
    }
    /**
     * Delete one notification by id.
     * 按 id 删除一条通知。
     */
    delete(id) {
        const notifications = this.load();
        const next = notifications.filter(item => item.id !== id);
        if (next.length === notifications.length)
            return false;
        this.save(next);
        return true;
    }
}
exports.NotificationStore = NotificationStore;
exports.notificationStore = new NotificationStore();
exports.default = exports.notificationStore;
//# sourceMappingURL=notification-store.js.map