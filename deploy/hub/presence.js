"use strict";
/**
 * JackClaw Hub - Presence Manager
 *
 * Tracks online/offline state for connected nodes.
 * Integrates with directoryStore to map nodeIds ↔ handles.
 *
 * A node is considered "online" when it has an active WebSocket connection.
 * Heartbeat timeout (60 s no pong) → auto-mark offline.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.presenceManager = void 0;
const directory_1 = require("./store/directory");
const HEARTBEAT_TIMEOUT_MS = 60_000;
const CHECK_INTERVAL_MS = 15_000;
class PresenceManager {
    nodes = new Map();
    checkTimer = null;
    constructor() {
        this._startTimeoutChecker();
    }
    // ─── Lifecycle ───────────────────────────────────────────────────────────────
    setOnline(nodeId, channels = ['ws']) {
        this.nodes.set(nodeId, {
            connectedAt: Date.now(),
            lastHeartbeat: Date.now(),
            connectedChannels: channels,
        });
        console.log(`[presence] ${nodeId} online (channels: ${channels.join(',')})`);
    }
    setOffline(nodeId) {
        if (this.nodes.has(nodeId)) {
            this.nodes.delete(nodeId);
            console.log(`[presence] ${nodeId} offline`);
        }
    }
    /** Record a heartbeat pong — resets the timeout window. */
    heartbeat(nodeId) {
        const p = this.nodes.get(nodeId);
        if (p)
            p.lastHeartbeat = Date.now();
    }
    // ─── Query API ───────────────────────────────────────────────────────────────
    isOnline(nodeId) {
        return this.nodes.has(nodeId);
    }
    /** Get all @handles whose backing nodeId is currently connected. */
    getOnlineHandles() {
        const handles = [];
        for (const [nodeId] of this.nodes) {
            handles.push(...directory_1.directoryStore.getHandlesForNode(nodeId));
        }
        return handles;
    }
    /** Returns the timestamp when the given nodeId connected, or null if offline. */
    getConnectedAt(nodeId) {
        return this.nodes.get(nodeId)?.connectedAt ?? null;
    }
    /** Presence info for a @handle (online state + last seen timestamp). */
    getPresence(handle) {
        const nodeId = directory_1.directoryStore.getNodeIdForHandle(handle);
        const profile = directory_1.directoryStore.getProfile(handle);
        if (!nodeId)
            return { online: false, lastSeen: profile?.lastSeen ?? null, connectedChannels: [] };
        const p = this.nodes.get(nodeId);
        return {
            online: !!p,
            lastSeen: profile?.lastSeen ?? null,
            connectedChannels: p?.connectedChannels ?? [],
        };
    }
    /**
     * Unified resolve: @handle → { nodeId, online, wsConnected }.
     * Use this everywhere instead of ad-hoc directory lookups.
     */
    resolveHandle(handle) {
        const nodeId = directory_1.directoryStore.getNodeIdForHandle(handle);
        if (!nodeId)
            return { nodeId: null, online: false, wsConnected: false };
        const p = this.nodes.get(nodeId);
        return {
            nodeId,
            online: !!p,
            wsConnected: !!p && p.connectedChannels.includes('ws'),
        };
    }
    // ─── Internal ────────────────────────────────────────────────────────────────
    _startTimeoutChecker() {
        this.checkTimer = setInterval(() => {
            const now = Date.now();
            for (const [nodeId, p] of this.nodes) {
                if (now - p.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
                    console.log(`[presence] ${nodeId} heartbeat timeout — marking offline`);
                    this.nodes.delete(nodeId);
                }
            }
        }, CHECK_INTERVAL_MS);
        this.checkTimer.unref();
    }
}
exports.presenceManager = new PresenceManager();
//# sourceMappingURL=presence.js.map