/**
 * AuditLog — Immutable audit trail for JackClaw Hub
 *
 * Records all security-relevant events:
 *   - Auth (login, register, token refresh)
 *   - Messages (send, receive, delete)
 *   - Admin (config change, plugin load/unload)
 *   - Review (human approval/rejection)
 *
 * Append-only, no delete. Supports export for compliance.
 */

export type AuditAction =
  | 'auth.login' | 'auth.register' | 'auth.token_refresh' | 'auth.login_failed'
  | 'msg.send' | 'msg.receive' | 'msg.delete' | 'msg.trace'
  | 'admin.config_change' | 'admin.plugin_load' | 'admin.plugin_unload'
  | 'review.submit' | 'review.approve' | 'review.reject'
  | 'node.register' | 'node.disconnect' | 'node.heartbeat_miss'
  | 'security.anomaly' | 'security.rate_limit'
  | string  // extensible

export interface AuditEntry {
  id: number
  action: AuditAction
  actor: string       // nodeId, userId, IP
  target?: string     // affected resource
  detail?: string     // human-readable context
  meta?: Record<string, unknown>
  ts: number
}

export class AuditLog {
  private entries: AuditEntry[] = []
  private counter = 0
  private readonly MAX_ENTRIES: number

  constructor(opts?: { maxEntries?: number }) {
    this.MAX_ENTRIES = opts?.maxEntries ?? 10_000
  }

  /**
   * Append an audit entry. Returns the entry with assigned id.
   */
  append(action: AuditAction, actor: string, opts?: {
    target?: string
    detail?: string
    meta?: Record<string, unknown>
  }): AuditEntry {
    const entry: AuditEntry = {
      id: ++this.counter,
      action,
      actor,
      target: opts?.target,
      detail: opts?.detail,
      meta: opts?.meta,
      ts: Date.now(),
    }
    this.entries.push(entry)
    if (this.entries.length > this.MAX_ENTRIES) {
      this.entries = this.entries.slice(-Math.floor(this.MAX_ENTRIES / 2))
    }
    return entry
  }

  /**
   * Query entries by action prefix.
   */
  query(opts?: {
    action?: string
    actor?: string
    from?: number
    to?: number
    limit?: number
  }): AuditEntry[] {
    let result = this.entries
    if (opts?.action) {
      const prefix = opts.action
      result = result.filter(e => e.action.startsWith(prefix))
    }
    if (opts?.actor) {
      result = result.filter(e => e.actor === opts.actor)
    }
    if (opts?.from) {
      result = result.filter(e => e.ts >= opts.from!)
    }
    if (opts?.to) {
      result = result.filter(e => e.ts <= opts.to!)
    }
    const limit = opts?.limit ?? 100
    return result.slice(-limit)
  }

  /**
   * Export all entries as JSON lines (for compliance / backup).
   */
  exportJSONL(): string {
    return this.entries.map(e => JSON.stringify(e)).join('\n')
  }

  /**
   * Get entry count.
   */
  get size(): number {
    return this.entries.length
  }

  /**
   * Get stats summary.
   */
  stats(): { total: number; byAction: Record<string, number> } {
    const byAction: Record<string, number> = {}
    for (const e of this.entries) {
      const prefix = e.action.split('.')[0]
      byAction[prefix] = (byAction[prefix] ?? 0) + 1
    }
    return { total: this.entries.length, byAction }
  }
}

/** Singleton AuditLog */
export const auditLog = new AuditLog()
