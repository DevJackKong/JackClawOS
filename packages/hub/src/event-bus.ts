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
  type: string
  data: unknown
  ts: number
  source?: string
}

type EventHandler = (event: EventPayload) => void | Promise<void>

interface Subscription {
  id: string
  pattern: string
  handler: EventHandler
  pluginName?: string
}

export class EventBus {
  private subscriptions = new Map<string, Subscription[]>()
  private wildcardSubs: Subscription[] = []
  private subCounter = 0
  private eventLog: EventPayload[] = []
  private readonly MAX_LOG = 1000

  /**
   * Subscribe to events matching a pattern.
   * @param pattern  Event type or wildcard (e.g., "msg.received", "msg.*", "*")
   * @param handler  Callback function
   * @param pluginName  Optional plugin identifier for tracking
   * @returns Subscription ID (for unsubscribe)
   */
  on(pattern: string, handler: EventHandler, pluginName?: string): string {
    const id = `sub_${++this.subCounter}`
    const sub: Subscription = { id, pattern, handler, pluginName }

    if (pattern === '*' || pattern.endsWith('.*')) {
      this.wildcardSubs.push(sub)
    } else {
      const existing = this.subscriptions.get(pattern) ?? []
      existing.push(sub)
      this.subscriptions.set(pattern, existing)
    }

    return id
  }

  /**
   * Unsubscribe by subscription ID.
   */
  off(subId: string): boolean {
    // Check exact subscriptions
    for (const [pattern, subs] of this.subscriptions) {
      const idx = subs.findIndex(s => s.id === subId)
      if (idx >= 0) {
        subs.splice(idx, 1)
        if (subs.length === 0) this.subscriptions.delete(pattern)
        return true
      }
    }
    // Check wildcard subscriptions
    const wIdx = this.wildcardSubs.findIndex(s => s.id === subId)
    if (wIdx >= 0) {
      this.wildcardSubs.splice(wIdx, 1)
      return true
    }
    return false
  }

  /**
   * Remove all subscriptions from a specific plugin.
   */
  offPlugin(pluginName: string): number {
    let removed = 0
    for (const [pattern, subs] of this.subscriptions) {
      const before = subs.length
      const filtered = subs.filter(s => s.pluginName !== pluginName)
      if (filtered.length < before) {
        removed += before - filtered.length
        if (filtered.length === 0) this.subscriptions.delete(pattern)
        else this.subscriptions.set(pattern, filtered)
      }
    }
    const wBefore = this.wildcardSubs.length
    this.wildcardSubs = this.wildcardSubs.filter(s => s.pluginName !== pluginName)
    removed += wBefore - this.wildcardSubs.length
    return removed
  }

  /**
   * Emit an event. All matching handlers are called (fire-and-forget).
   * Errors in handlers are caught and logged, never propagated.
   */
  emit(type: string, data: unknown, source?: string): void {
    const event: EventPayload = { type, data, ts: Date.now(), source }

    // Log event
    this.eventLog.push(event)
    if (this.eventLog.length > this.MAX_LOG) {
      this.eventLog = this.eventLog.slice(-this.MAX_LOG / 2)
    }

    // Exact match subscribers
    const exact = this.subscriptions.get(type) ?? []
    for (const sub of exact) {
      this._safeCall(sub, event)
    }

    // Wildcard subscribers
    for (const sub of this.wildcardSubs) {
      if (this._matchesWildcard(sub.pattern, type)) {
        this._safeCall(sub, event)
      }
    }
  }

  /**
   * Get recent events (for debugging / observability).
   */
  getRecentEvents(limit = 50): EventPayload[] {
    return this.eventLog.slice(-limit)
  }

  /**
   * Get subscription count.
   */
  get subscriptionCount(): number {
    let count = this.wildcardSubs.length
    for (const subs of this.subscriptions.values()) {
      count += subs.length
    }
    return count
  }

  private _safeCall(sub: Subscription, event: EventPayload): void {
    try {
      const result = sub.handler(event)
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(err => {
          console.error(`[event-bus] Handler error in ${sub.pluginName ?? sub.id} for ${event.type}:`, err)
        })
      }
    } catch (err) {
      console.error(`[event-bus] Sync handler error in ${sub.pluginName ?? sub.id} for ${event.type}:`, err)
    }
  }

  private _matchesWildcard(pattern: string, type: string): boolean {
    if (pattern === '*') return true
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2)
      return type.startsWith(prefix + '.')
    }
    return pattern === type
  }
}

/** Singleton EventBus for the Hub */
export const eventBus = new EventBus()
