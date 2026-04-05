/**
 * JackClaw Hub - Presence Manager
 *
 * Tracks online/offline state for connected nodes.
 * Integrates with directoryStore to map nodeIds ↔ handles.
 *
 * A node is considered "online" when it has an active WebSocket connection.
 * Heartbeat timeout (60 s no pong) → auto-mark offline.
 */

import { directoryStore } from './store/directory'

const HEARTBEAT_TIMEOUT_MS = 60_000
const CHECK_INTERVAL_MS    = 15_000

interface NodePresenceRecord {
  connectedAt: number
  lastHeartbeat: number
  connectedChannels: string[]
}

export interface PresenceInfo {
  online: boolean
  lastSeen: number | null
  connectedChannels: string[]
}

export interface ResolvedHandle {
  nodeId: string | null
  online: boolean
  wsConnected: boolean
}

class PresenceManager {
  private nodes = new Map<string, NodePresenceRecord>()
  private checkTimer: NodeJS.Timeout | null = null

  constructor() {
    this._startTimeoutChecker()
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  setOnline(nodeId: string, channels: string[] = ['ws']): void {
    this.nodes.set(nodeId, {
      connectedAt:       Date.now(),
      lastHeartbeat:     Date.now(),
      connectedChannels: channels,
    })
    console.log(`[presence] ${nodeId} online (channels: ${channels.join(',')})`)
  }

  setOffline(nodeId: string): void {
    if (this.nodes.has(nodeId)) {
      this.nodes.delete(nodeId)
      console.log(`[presence] ${nodeId} offline`)
    }
  }

  /** Record a heartbeat pong — resets the timeout window. */
  heartbeat(nodeId: string): void {
    const p = this.nodes.get(nodeId)
    if (p) p.lastHeartbeat = Date.now()
  }

  // ─── Query API ───────────────────────────────────────────────────────────────

  isOnline(nodeId: string): boolean {
    return this.nodes.has(nodeId)
  }

  /** Get all @handles whose backing nodeId is currently connected. */
  getOnlineHandles(): string[] {
    const handles: string[] = []
    for (const [nodeId] of this.nodes) {
      handles.push(...directoryStore.getHandlesForNode(nodeId))
    }
    return handles
  }

  /** Returns the timestamp when the given nodeId connected, or null if offline. */
  getConnectedAt(nodeId: string): number | null {
    return this.nodes.get(nodeId)?.connectedAt ?? null
  }

  /** Presence info for a @handle (online state + last seen timestamp). */
  getPresence(handle: string): PresenceInfo {
    const nodeId  = directoryStore.getNodeIdForHandle(handle)
    const profile = directoryStore.getProfile(handle)
    if (!nodeId) return { online: false, lastSeen: profile?.lastSeen ?? null, connectedChannels: [] }

    const p = this.nodes.get(nodeId)
    return {
      online:            !!p,
      lastSeen:          profile?.lastSeen ?? null,
      connectedChannels: p?.connectedChannels ?? [],
    }
  }

  /**
   * Unified resolve: @handle → { nodeId, online, wsConnected }.
   * Use this everywhere instead of ad-hoc directory lookups.
   */
  resolveHandle(handle: string): ResolvedHandle {
    const nodeId = directoryStore.getNodeIdForHandle(handle)
    if (!nodeId) return { nodeId: null, online: false, wsConnected: false }

    const p = this.nodes.get(nodeId)
    return {
      nodeId,
      online:      !!p,
      wsConnected: !!p && p.connectedChannels.includes('ws'),
    }
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private _startTimeoutChecker(): void {
    this.checkTimer = setInterval(() => {
      const now = Date.now()
      for (const [nodeId, p] of this.nodes) {
        if (now - p.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
          console.log(`[presence] ${nodeId} heartbeat timeout — marking offline`)
          this.nodes.delete(nodeId)
        }
      }
    }, CHECK_INTERVAL_MS)
    this.checkTimer.unref()
  }
}

export const presenceManager = new PresenceManager()
