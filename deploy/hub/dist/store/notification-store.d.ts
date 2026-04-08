export interface Notification {
    id: string;
    tenantId: string;
    userId: string;
    type: 'info' | 'warning' | 'error' | 'success' | 'task' | 'approval' | 'system';
    title: string;
    body?: string;
    link?: string;
    read: boolean;
    metadata?: Record<string, unknown>;
    createdAt: number;
}
/**
 * JSON-file-backed notification store.
 * 基于 JSON 文件的通知存储。
 */
export declare class NotificationStore {
    private readonly file;
    constructor(file?: string);
    /**
     * Load all notifications from disk.
     * 从磁盘加载全部通知。
     */
    private load;
    /**
     * Persist all notifications to disk.
     * 将全部通知持久化到磁盘。
     */
    private save;
    /**
     * Create one notification.
     * 创建一条通知。
     */
    create(tenantId: string, userId: string, type: Notification['type'], title: string, opts?: Partial<Notification>): Notification;
    /**
     * Get one notification by id.
     * 按 id 获取单条通知。
     */
    get(id: string): Notification | null;
    /**
     * List notifications for one user.
     * 按用户列出通知。
     */
    listByUser(userId: string, opts?: {
        unreadOnly?: boolean;
        limit?: number;
    }): Notification[];
    /**
     * Mark one notification as read.
     * 将单条通知标记为已读。
     */
    markRead(id: string): Notification;
    /**
     * Mark all notifications of one user as read.
     * 将某个用户的全部通知标记为已读。
     */
    markAllRead(userId: string): number;
    /**
     * Count unread notifications of one user.
     * 统计某个用户的未读通知数。
     */
    unreadCount(userId: string): number;
    /**
     * Delete one notification by id.
     * 按 id 删除一条通知。
     */
    delete(id: string): boolean;
}
export declare const notificationStore: NotificationStore;
export default notificationStore;
//# sourceMappingURL=notification-store.d.ts.map