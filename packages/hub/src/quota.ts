/**
 * JackClaw Hub — Quota Manager
 *
 * Per-user resource limits with persistent usage tracking.
 * Config overrides: ~/.jackclaw/hub/quota.json
 * Usage state:      ~/.jackclaw/hub/quota-usage.json
 *
 * Default limits:
 *   maxFileStorage:    500 MB  (per user, cumulative uploads)
 *   maxMessagePerDay:  1 000   (per user, resets at midnight)
 *   maxFileSize:       50 MB   (single file — enforced at upload)
 *   maxContacts:       500
 *   maxGroups:         50
 */

import fs from 'fs'
import path from 'path'

// ─── Paths ────────────────────────────────────────────────────────────────────

const HUB_DIR   = path.join(process.env.HOME ?? '~', '.jackclaw', 'hub')
const CONFIG_FILE = path.join(HUB_DIR, 'quota.json')
const USAGE_FILE  = path.join(HUB_DIR, 'quota-usage.json')

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QuotaLimits {
  maxFileStorage:   number   // bytes
  maxMessagePerDay: number
  maxFileSize:      number   // bytes
  maxContacts:      number
  maxGroups:        number
}

export type QuotaResource = keyof QuotaLimits

interface UsageRecord {
  fileStorage:    number   // bytes uploaded (cumulative)
  messageCount:   number   // messages sent today
  messageDate:    string   // YYYY-MM-DD of current window
  contacts:       number   // current contact count (refreshed on check)
  groups:         number   // current group count (refreshed on check)
}

export interface QuotaCheckResult {
  allowed:   boolean
  remaining: number   // how many more units are allowed (-1 = unlimited)
  limit:     number
  used:      number
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULTS: QuotaLimits = {
  maxFileStorage:   500 * 1024 * 1024,  // 500 MB
  maxMessagePerDay: 1_000,
  maxFileSize:      50  * 1024 * 1024,  // 50 MB
  maxContacts:      500,
  maxGroups:        50,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)   // "YYYY-MM-DD"
}

function loadJSON<T>(file: string, fallback: T): T {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8')) as T
  } catch { /* ignore */ }
  return fallback
}

function saveJSON(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
}

// ─── QuotaManager ─────────────────────────────────────────────────────────────

export class QuotaManager {
  private limits: QuotaLimits

  constructor() {
    const overrides = loadJSON<Partial<QuotaLimits>>(CONFIG_FILE, {})
    this.limits = { ...DEFAULTS, ...overrides }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Check whether a user is allowed to consume `amount` units of `resource`.
   * For fileStorage / fileSize, amount is bytes.
   * For messagePerDay, amount is 1 (one message at a time).
   */
  checkQuota(userId: string, resource: QuotaResource, amount = 1): QuotaCheckResult {
    const usage  = this._loadUsage()
    const record = this._getRecord(usage, userId)
    const limit  = this.limits[resource]

    let used: number

    switch (resource) {
      case 'maxFileStorage':
        used = record.fileStorage
        break
      case 'maxMessagePerDay':
        used = record.messageDate === todayStr() ? record.messageCount : 0
        break
      case 'maxFileSize':
        // Single-file check: amount IS the file size
        return {
          allowed:   amount <= limit,
          remaining: Math.max(0, limit - amount),
          limit,
          used:      amount,
        }
      case 'maxContacts':
        used = record.contacts
        break
      case 'maxGroups':
        used = record.groups
        break
      default:
        return { allowed: true, remaining: -1, limit: -1, used: 0 }
    }

    const allowed   = used + amount <= limit
    const remaining = Math.max(0, limit - used)
    return { allowed, remaining, limit, used }
  }

  /**
   * Increment a tracked resource for a user.
   * Call this after the operation succeeds.
   */
  incrementUsage(userId: string, resource: QuotaResource, amount = 1): void {
    const usage  = this._loadUsage()
    const record = this._getRecord(usage, userId)

    switch (resource) {
      case 'maxFileStorage':
        record.fileStorage = Math.max(0, record.fileStorage + amount)
        break
      case 'maxMessagePerDay': {
        const today = todayStr()
        if (record.messageDate !== today) {
          record.messageCount = 0
          record.messageDate  = today
        }
        record.messageCount += amount
        break
      }
      case 'maxContacts':
        record.contacts = Math.max(0, record.contacts + amount)
        break
      case 'maxGroups':
        record.groups = Math.max(0, record.groups + amount)
        break
      // maxFileSize is stateless — nothing to persist
    }

    usage[userId] = record
    saveJSON(USAGE_FILE, usage)
  }

  /**
   * Directly set a counter (e.g., after a full recount of contacts/groups).
   */
  setUsage(userId: string, resource: QuotaResource, value: number): void {
    const usage  = this._loadUsage()
    const record = this._getRecord(usage, userId)

    switch (resource) {
      case 'maxFileStorage':   record.fileStorage  = value; break
      case 'maxMessagePerDay': record.messageCount = value; break
      case 'maxContacts':      record.contacts     = value; break
      case 'maxGroups':        record.groups       = value; break
    }

    usage[userId] = record
    saveJSON(USAGE_FILE, usage)
  }

  /** Return a snapshot of a user's current usage and limits. */
  getUsage(userId: string): UsageRecord & { limits: QuotaLimits } {
    const usage  = this._loadUsage()
    const record = this._getRecord(usage, userId)
    // Reset daily counter if stale
    if (record.messageDate !== todayStr()) {
      record.messageCount = 0
      record.messageDate  = todayStr()
    }
    return { ...record, limits: { ...this.limits } }
  }

  /** Expose effective limits (merged defaults + config overrides). */
  getLimits(): Readonly<QuotaLimits> {
    return this.limits
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private _loadUsage(): Record<string, UsageRecord> {
    return loadJSON<Record<string, UsageRecord>>(USAGE_FILE, {})
  }

  private _getRecord(usage: Record<string, UsageRecord>, userId: string): UsageRecord {
    if (!usage[userId]) {
      usage[userId] = {
        fileStorage:  0,
        messageCount: 0,
        messageDate:  todayStr(),
        contacts:     0,
        groups:       0,
      }
    }
    return usage[userId]
  }
}

/** Singleton — import and use throughout route handlers. */
export const quotaManager = new QuotaManager()
