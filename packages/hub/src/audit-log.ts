/**
 * JackClaw Hub — Audit Logger
 *
 * Append-only JSONL audit trail at ~/.jackclaw/hub/audit.jsonl.
 * Tracks: login, register, message_send, file_upload, admin_action, security_alert.
 *
 * Retention: configurable via ~/.jackclaw/hub/audit-config.json
 * Default: 90 days.  cleanup() rewrites the log dropping expired entries.
 * cleanup() is called automatically at startup.
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

// ─── Types ────────────────────────────────────────────────────────────────────

const HUB_DIR          = path.join(process.env.HOME ?? '~', '.jackclaw', 'hub')
const AUDIT_FILE       = path.join(HUB_DIR, 'audit.jsonl')
const AUDIT_CONFIG_FILE = path.join(HUB_DIR, 'audit-config.json')

export type AuditEventType =
  | 'login'
  | 'register'
  | 'message_send'
  | 'file_upload'
  | 'admin_action'
  | 'security_alert'

export interface AuditEvent {
  id: string
  type: AuditEventType
  timestamp: number
  ip?: string
  handle?: string
  nodeId?: string
  details: Record<string, unknown>
}

export interface AuditQueryFilters {
  type?: AuditEventType
  handle?: string
  nodeId?: string
  fromTs?: number
  toTs?: number
  /** Max results returned (default 1000, applied from newest) */
  limit?: number
}

interface AuditConfig {
  retentionDays: number   // default 90
}

// ─── AuditLogger ─────────────────────────────────────────────────────────────

export class AuditLogger {
  private readonly logFile: string
  readonly retentionDays: number

  constructor(logFile = AUDIT_FILE) {
    this.logFile = logFile
    fs.mkdirSync(path.dirname(this.logFile), { recursive: true })

    const config = this._loadConfig()
    this.retentionDays = config.retentionDays

    // Auto-cleanup expired entries at startup
    this.cleanup()
  }

  /**
   * Append an audit event to the log.
   * The file is opened with O_APPEND — safe for concurrent writes on the same host.
   * Entries are never modified or deleted (except by cleanup()).
   */
  log(
    type: AuditEventType,
    details: Record<string, unknown> & { ip?: string; handle?: string; nodeId?: string },
  ): void {
    const { ip, handle, nodeId, ...rest } = details
    const event: AuditEvent = {
      id: crypto.randomUUID(),
      type,
      timestamp: Date.now(),
      ...(ip      !== undefined && { ip }),
      ...(handle  !== undefined && { handle }),
      ...(nodeId  !== undefined && { nodeId }),
      details: rest,
    }
    fs.appendFileSync(this.logFile, JSON.stringify(event) + '\n', { encoding: 'utf-8', flag: 'a' })
  }

  /**
   * Query the audit log.
   * Reads the entire file and filters in-memory.
   */
  query(filters: AuditQueryFilters = {}): AuditEvent[] {
    if (!fs.existsSync(this.logFile)) return []

    const raw = fs.readFileSync(this.logFile, 'utf-8')
    const events: AuditEvent[] = []

    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        events.push(JSON.parse(line) as AuditEvent)
      } catch { /* skip malformed lines */ }
    }

    let result = events
    if (filters.type)    result = result.filter(e => e.type    === filters.type)
    if (filters.handle)  result = result.filter(e => e.handle  === filters.handle)
    if (filters.nodeId)  result = result.filter(e => e.nodeId  === filters.nodeId)
    if (filters.fromTs)  result = result.filter(e => e.timestamp >= filters.fromTs!)
    if (filters.toTs)    result = result.filter(e => e.timestamp <= filters.toTs!)

    // Return the newest N events
    const limit = filters.limit ?? 1000
    return result.slice(-limit)
  }

  /**
   * Delete log entries older than retentionDays.
   * Rewrites the log file in-place (atomic via temp file).
   */
  cleanup(): void {
    if (!fs.existsSync(this.logFile)) return

    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000
    const raw    = fs.readFileSync(this.logFile, 'utf-8')
    const lines  = raw.split('\n').filter(l => l.trim())

    let kept     = 0
    let removed  = 0
    const kept_lines: string[] = []

    for (const line of lines) {
      try {
        const event = JSON.parse(line) as AuditEvent
        if (event.timestamp >= cutoff) {
          kept_lines.push(line)
          kept++
        } else {
          removed++
        }
      } catch {
        // Keep malformed lines to avoid data loss
        kept_lines.push(line)
        kept++
      }
    }

    if (removed === 0) return   // nothing to do

    const tmpFile = this.logFile + '.tmp'
    fs.writeFileSync(tmpFile, kept_lines.join('\n') + (kept_lines.length > 0 ? '\n' : ''), 'utf-8')
    fs.renameSync(tmpFile, this.logFile)

    console.log(`[audit] Cleanup: removed ${removed} expired entries (older than ${this.retentionDays} days), kept ${kept}`)
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private _loadConfig(): AuditConfig {
    try {
      if (fs.existsSync(AUDIT_CONFIG_FILE)) {
        const cfg = JSON.parse(fs.readFileSync(AUDIT_CONFIG_FILE, 'utf-8')) as Partial<AuditConfig>
        return { retentionDays: cfg.retentionDays ?? 90 }
      }
    } catch { /* ignore */ }
    return { retentionDays: 90 }
  }
}

/** Singleton logger — use this in route handlers. */
export const auditLogger = new AuditLogger()
