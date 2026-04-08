import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const HUB_DIR = path.join(process.env.HOME || '~', '.jackclaw', 'hub')
const AUDIT_STORE_FILE = path.join(HUB_DIR, 'api-audit.jsonl')

/**
 * API audit log entry.
 * API 审计日志记录结构。
 */
export interface ApiAuditLogEntry {
  id?: string
  timestamp?: number
  tenantId?: string
  orgId?: string
  userId?: string
  method: string
  path: string
  statusCode: number
  result: 'success' | 'rejected' | 'failure'
  ip?: string
  userAgent?: string
  durationMs?: number
  // 扩展字段 / extended fields for manual audit
  action?: string
  category?: string
  actorId?: string
  actorType?: string
  [key: string]: unknown
}

/**
 * Lightweight append-only audit store with query support.
 * 轻量级追加写入审计存储，支持查询。
 */
class AuditStore {
  private readonly filePath: string

  constructor(filePath = AUDIT_STORE_FILE) {
    this.filePath = filePath
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
  }

  /**
   * Persist one audit entry as JSONL.
   * 以 JSONL 形式持久化一条审计记录。
   */
  log(entry: Partial<ApiAuditLogEntry>): ApiAuditLogEntry {
    const payload: ApiAuditLogEntry = {
      method: entry.method ?? 'POST',
      path: entry.path ?? entry.action ?? '',
      statusCode: entry.statusCode ?? 200,
      result: entry.result ?? 'success',
      ...entry,
      id: entry.id ?? crypto.randomUUID(),
      timestamp: entry.timestamp ?? Date.now(),
    }

    fs.appendFileSync(this.filePath, `${JSON.stringify(payload)}\n`, {
      encoding: 'utf-8',
      flag: 'a',
    })

    return payload
  }

  /**
   * Load all entries from JSONL file.
   * 从 JSONL 文件加载所有记录。
   */
  private loadAll(): ApiAuditLogEntry[] {
    if (!fs.existsSync(this.filePath)) return []
    const lines = fs.readFileSync(this.filePath, 'utf-8').split('\n').filter(Boolean)
    const entries: ApiAuditLogEntry[] = []
    for (const line of lines) {
      try { entries.push(JSON.parse(line)) } catch { /* skip bad lines */ }
    }
    return entries
  }

  /**
   * Get a single entry by id.
   * 按 ID 获取单条记录。
   */
  get(id: string): ApiAuditLogEntry | null {
    return this.loadAll().find(e => e.id === id) ?? null
  }

  /**
   * Query entries with filters.
   * 按条件查询记录。
   */
  query(opts: {
    tenantId?: string; category?: string; actorId?: string;
    action?: string; result?: string; from?: number; to?: number; limit?: number
  } = {}): ApiAuditLogEntry[] {
    let entries = this.loadAll()

    if (opts.tenantId) entries = entries.filter(e => e.tenantId === opts.tenantId)
    if (opts.category) entries = entries.filter(e => e.category === opts.category)
    if (opts.actorId) entries = entries.filter(e => (e.actorId ?? e.userId) === opts.actorId)
    if (opts.action) entries = entries.filter(e => (e.action ?? e.path)?.includes(opts.action!))
    if (opts.result) entries = entries.filter(e => e.result === opts.result)
    if (opts.from) entries = entries.filter(e => (e.timestamp ?? 0) >= opts.from!)
    if (opts.to) entries = entries.filter(e => (e.timestamp ?? 0) <= opts.to!)

    // 按时间倒序 / descending by timestamp
    entries.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))

    return entries.slice(0, opts.limit ?? 100)
  }

  /**
   * Get stats for a tenant.
   * 获取租户审计统计。
   */
  stats(tenantId?: string, from?: number, to?: number): {
    total: number
    byResult: Record<string, number>
    byMethod: Record<string, number>
  } {
    let entries = this.loadAll()
    if (tenantId) entries = entries.filter(e => e.tenantId === tenantId)
    if (from) entries = entries.filter(e => (e.timestamp ?? 0) >= from)
    if (to) entries = entries.filter(e => (e.timestamp ?? 0) <= to)

    const byResult: Record<string, number> = {}
    const byMethod: Record<string, number> = {}
    for (const e of entries) {
      byResult[e.result] = (byResult[e.result] ?? 0) + 1
      byMethod[e.method] = (byMethod[e.method] ?? 0) + 1
    }

    return { total: entries.length, byResult, byMethod }
  }
}

export const auditStore = new AuditStore()
export default auditStore
