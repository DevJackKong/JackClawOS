/**
 * JackClaw EventBus — publish/subscribe with wildcard filtering
 *
 * Core nervous system for the Plugin architecture.
 * All modules communicate through events, not direct imports.
 *
 * Event naming convention: "domain.action"
 *   msg.received     — new message arrived at Hub
 *   msg.sent         — message pushed to target WS
 *   msg.acked        — delivery ACK received
 *   msg.failed       — delivery failed
 *   user.online      — node connected
 *   user.offline     — node disconnected
 *   task.created     — new task submitted
 *   task.completed   — task finished
 *   plugin.loaded    — plugin registered
 *   plugin.unloaded  — plugin removed
 *
 * Wildcard: "msg.*" matches all msg events
 *           "*" matches everything
 */
export type HubEvents = string;
export interface EventPayload {
    type: string;
    data: unknown;
    ts: number;
    source?: string;
}
/**
 * Standard Hub event type constants / Hub 标准事件类型常量。
 *
 * 用法 / Usage:
 *   eventBus.emit(HubEvents.MSG_RECEIVED, payload)
 *   eventBus.on(HubEvents.TASK_COMPLETED, handler)
 */
export declare const HubEvents: {
    readonly MSG_RECEIVED: "msg.received";
    readonly MSG_SENT: "msg.sent";
    readonly MSG_ACKED: "msg.acked";
    readonly MSG_FAILED: "msg.failed";
    readonly TASK_CREATED: "task.created";
    readonly TASK_ASSIGNED: "task.assigned";
    readonly TASK_STARTED: "task.started";
    readonly TASK_COMPLETED: "task.completed";
    readonly TASK_FAILED: "task.failed";
    readonly APPROVAL_REQUESTED: "approval.requested";
    readonly APPROVAL_APPROVED: "approval.approved";
    readonly APPROVAL_REJECTED: "approval.rejected";
    readonly MEMORY_UPDATED: "memory.updated";
    readonly MEMORY_SYNCED: "memory.synced";
    readonly USER_ONLINE: "user.online";
    readonly USER_OFFLINE: "user.offline";
    readonly PLUGIN_LOADED: "plugin.loaded";
    readonly PLUGIN_UNLOADED: "plugin.unloaded";
    readonly TENANT_CREATED: "tenant.created";
    readonly TENANT_UPDATED: "tenant.updated";
    readonly ORG_CREATED: "org.created";
    readonly MEMBER_ADDED: "member.added";
    readonly MEMBER_REMOVED: "member.removed";
    readonly ROLE_ASSIGNED: "role.assigned";
};
type EventHandler = (event: EventPayload) => void | Promise<void>;
export declare class EventBus {
    private subscriptions;
    private wildcardSubs;
    private subCounter;
    private eventLog;
    private readonly MAX_LOG;
    /**
     * Subscribe to events matching a pattern.
     * @param pattern  Event type or wildcard (e.g., "msg.received", "msg.*", "*")
     * @param handler  Callback function
     * @param pluginName  Optional plugin identifier for tracking
     * @returns Subscription ID (for unsubscribe)
     */
    on(pattern: string, handler: EventHandler, pluginName?: string): string;
    /**
     * Subscribe once: auto-unsubscribe after the first matched event.
     * 单次订阅：命中一次后自动取消订阅。
     *
     * @param pattern Event type or wildcard / 事件类型或通配符
     * @param handler One-time callback / 只执行一次的回调
     * @param pluginName Optional plugin identifier / 可选插件标识
     * @returns Subscription ID / 订阅 ID
     */
    once(pattern: string, handler: EventHandler, pluginName?: string): string;
    /**
     * Wait for the next event matching the pattern.
     * 等待下一个匹配 pattern 的事件。
     *
     * @param pattern Event type or wildcard / 事件类型或通配符
     * @param timeoutMs Optional timeout in milliseconds / 可选超时时间（毫秒）
     * @returns Promise resolved with the matched event / 返回命中事件的 Promise
     */
    waitFor(pattern: string, timeoutMs?: number): Promise<EventPayload>;
    /**
     * Unsubscribe by subscription ID.
     */
    off(subId: string): boolean;
    /**
     * Remove all subscriptions from a specific plugin.
     */
    offPlugin(pluginName: string): number;
    /**
     * Emit an event. All matching handlers are called (fire-and-forget).
     * Errors in handlers are caught and logged, never propagated.
     */
    emit(type: string, data: unknown, source?: string): void;
    /**
     * Emit an event and wait for all matching handlers to finish.
     * 异步发布事件：等待所有匹配 handler 执行完成后再返回。
     *
     * 与 emit 不同，emitAsync 会聚合并等待所有异步/同步 handler。
     * Unlike emit(), emitAsync() awaits all matching handlers.
     */
    emitAsync(type: string, data: unknown, source?: string): Promise<void>;
    /**
     * Get recent events (for debugging / observability).
     */
    getRecentEvents(limit?: number): EventPayload[];
    /**
     * Get subscription count.
     */
    get subscriptionCount(): number;
    private _safeCall;
    /**
     * Safe async handler execution used by emitAsync.
     * emitAsync 使用的安全异步调用，保证单个 handler 异常不会中断整体派发。
     */
    private _safeCallAsync;
    private _matchesWildcard;
}
/** Singleton EventBus for the Hub */
export declare const eventBus: EventBus;
export {};
//# sourceMappingURL=event-bus.d.ts.map