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
export interface EventPayload {
    type: string;
    data: unknown;
    ts: number;
    source?: string;
}
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
     * Get recent events (for debugging / observability).
     */
    getRecentEvents(limit?: number): EventPayload[];
    /**
     * Get subscription count.
     */
    get subscriptionCount(): number;
    private _safeCall;
    private _matchesWildcard;
}
/** Singleton EventBus for the Hub */
export declare const eventBus: EventBus;
export {};
//# sourceMappingURL=event-bus.d.ts.map