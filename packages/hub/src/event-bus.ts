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

export type HubEvents = string

export interface EventPayload {
  type: string
  data: unknown
  ts: number
  source?: string
}

/**
 * Standard Hub event type constants / Hub 标准事件类型常量。
 *
 * 用法 / Usage:
 *   eventBus.emit(HubEvents.MSG_RECEIVED, payload)
 *   eventBus.on(HubEvents.TASK_COMPLETED, handler)
 */
export const HubEvents = {
  MSG_RECEIVED: 'msg.received',
  MSG_SENT: 'msg.sent',
  MSG_ACKED: 'msg.acked',
  MSG_FAILED: 'msg.failed',
  TASK_CREATED: 'task.created',
  TASK_ASSIGNED: 'task.assigned',
  TASK_STARTED: 'task.started',
  TASK_COMPLETED: 'task.completed',
  TASK_FAILED: 'task.failed',
  APPROVAL_REQUESTED: 'approval.requested',
  APPROVAL_APPROVED: 'approval.approved',
  APPROVAL_REJECTED: 'approval.rejected',
  MEMORY_UPDATED: 'memory.updated',
  MEMORY_SYNCED: 'memory.synced',
  USER_ONLINE: 'user.online',
  USER_OFFLINE: 'user.offline',
  PLUGIN_LOADED: 'plugin.loaded',
  PLUGIN_UNLOADED: 'plugin.unloaded',
  TENANT_CREATED: 'tenant.created',
  TENANT_UPDATED: 'tenant.updated',
  ORG_CREATED: 'org.created',
  MEMBER_ADDED: 'member.added',
  MEMBER_REMOVED: 'member.removed',
  ROLE_ASSIGNED: 'role.assigned',
} as const

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
   * Subscribe once: auto-unsubscribe after the first matched event.
   * 单次订阅：命中一次后自动取消订阅。
   *
   * @param pattern Event type or wildcard / 事件类型或通配符
   * @param handler One-time callback / 只执行一次的回调
   * @param pluginName Optional plugin identifier / 可选插件标识
   * @returns Subscription ID / 订阅 ID
   */
  once(pattern: string, handler: EventHandler, pluginName?: string): string {
    let subId = ''

    const wrappedHandler: EventHandler = async event => {
      this.off(subId)
      await handler(event)
    }

    subId = this.on(pattern, wrappedHandler, pluginName)
    return subId
  }

  /**
   * Wait for the next event matching the pattern.
   * 等待下一个匹配 pattern 的事件。
   *
   * @param pattern Event type or wildcard / 事件类型或通配符
   * @param timeoutMs Optional timeout in milliseconds / 可选超时时间（毫秒）
   * @returns Promise resolved with the matched event / 返回命中事件的 Promise
   */
  waitFor(pattern: string, timeoutMs?: number): Promise<EventPayload> {
    return new Promise<EventPayload>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined

      const subId = this.once(pattern, event => {
        if (timer) clearTimeout(timer)
        resolve(event)
      })

      if (typeof timeoutMs === 'number' && timeoutMs > 0) {
        timer = setTimeout(() => {
          this.off(subId)
          reject(new Error(`[event-bus] waitFor timeout for pattern: ${pattern}`))
        }, timeoutMs)
      }
    })
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
   * Emit an event and wait for all matching handlers to finish.
   * 异步发布事件：等待所有匹配 handler 执行完成后再返回。
   *
   * 与 emit 不同，emitAsync 会聚合并等待所有异步/同步 handler。
   * Unlike emit(), emitAsync() awaits all matching handlers.
   */
  async emitAsync(type: string, data: unknown, source?: string): Promise<void> {
    const event: EventPayload = { type, data, ts: Date.now(), source }

    // Log event / 记录事件
    this.eventLog.push(event)
    if (this.eventLog.length > this.MAX_LOG) {
      this.eventLog = this.eventLog.slice(-this.MAX_LOG / 2)
    }

    const pending: Promise<void>[] = []

    // Exact match subscribers / 精确匹配订阅
    const exact = this.subscriptions.get(type) ?? []
    for (const sub of exact) {
      pending.push(this._safeCallAsync(sub, event))
    }

    // Wildcard subscribers / 通配符订阅
    for (const sub of this.wildcardSubs) {
      if (this._matchesWildcard(sub.pattern, type)) {
        pending.push(this._safeCallAsync(sub, event))
      }
    }

    await Promise.all(pending)
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

  /**
   * Safe async handler execution used by emitAsync.
   * emitAsync 使用的安全异步调用，保证单个 handler 异常不会中断整体派发。
   */
  private async _safeCallAsync(sub: Subscription, event: EventPayload): Promise<void> {
    try {
      await sub.handler(event)
    } catch (err) {
      console.error(`[event-bus] Async handler error in ${sub.pluginName ?? sub.id} for ${event.type}:`, err)
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
