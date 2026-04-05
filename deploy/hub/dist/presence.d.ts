/**
 * JackClaw Hub - Presence Manager
 *
 * Tracks online/offline state for connected nodes.
 * Integrates with directoryStore to map nodeIds ↔ handles.
 *
 * A node is considered "online" when it has an active WebSocket connection.
 * Heartbeat timeout (60 s no pong) → auto-mark offline.
 */
export interface PresenceInfo {
    online: boolean;
    lastSeen: number | null;
    connectedChannels: string[];
}
export interface ResolvedHandle {
    nodeId: string | null;
    online: boolean;
    wsConnected: boolean;
}
declare class PresenceManager {
    private nodes;
    private checkTimer;
    constructor();
    setOnline(nodeId: string, channels?: string[]): void;
    setOffline(nodeId: string): void;
    /** Record a heartbeat pong — resets the timeout window. */
    heartbeat(nodeId: string): void;
    isOnline(nodeId: string): boolean;
    /** Get all @handles whose backing nodeId is currently connected. */
    getOnlineHandles(): string[];
    /** Returns the timestamp when the given nodeId connected, or null if offline. */
    getConnectedAt(nodeId: string): number | null;
    /** Presence info for a @handle (online state + last seen timestamp). */
    getPresence(handle: string): PresenceInfo;
    /**
     * Unified resolve: @handle → { nodeId, online, wsConnected }.
     * Use this everywhere instead of ad-hoc directory lookups.
     */
    resolveHandle(handle: string): ResolvedHandle;
    private _startTimeoutChecker;
}
export declare const presenceManager: PresenceManager;
export {};
//# sourceMappingURL=presence.d.ts.map