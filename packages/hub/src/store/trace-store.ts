// JackClaw Hub - Trace Store
// Persists to ~/.jackclaw/hub/traces.jsonl (append-only)

import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'

const HUB_DIR = path.join(os.homedir(), '.jackclaw', 'hub')
const TRACES_FILE = path.join(HUB_DIR, 'traces.jsonl')

export interface TraceEntry {
  id: string
  tenantId: string
  type: 'message' | 'task' | 'approval' | 'memory' | 'delegation' | 'system'
  action: string
  actorId: string
  targetId?: string
  parentTraceId?: string
  metadata?: Record<string, unknown>
  timestamp: number
}

export interface TraceSearchQuery {
  tenantId?: string
  type?: string
  action?: string
  from?: number
  to?: number
}

/**
 * Read JSONL file into memory.
 * 读取 JSONL 文件到内存；坏行自动跳过。
 */
function loadJsonl(file: string): TraceEntry[] {
  try {
    if (!fs.existsSync(file)) return []

    const raw = fs.readFileSync(file, 'utf-8')
    if (!raw.trim()) return []

    const entries: TraceEntry[] = []
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        entries.push(JSON.parse(trimmed) as TraceEntry)
      } catch {
        // Skip invalid line / 跳过损坏行
      }
    }
    return entries
  } catch {
    return []
  }
}

/**
 * Append one JSONL record.
 * 追加一条 JSONL 记录。
 */
function appendJsonl(file: string, entry: TraceEntry): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf-8')
}

/**
 * Normalize optional limit.
 * 标准化 limit，避免非法值。
 */
function normalizeLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return 50
  return Math.floor(limit)
}

/**
 * Sort newest first, then apply limit.
 * 先按时间倒序，再截断数量。
 */
function newestFirst(entries: TraceEntry[], limit?: number): TraceEntry[] {
  return [...entries]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, normalizeLimit(limit))
}

export class TraceStore {
  private readonly file: string
  private traces: TraceEntry[]
  private byId: Map<string, TraceEntry>

  constructor(file = TRACES_FILE) {
    this.file = file
    this.traces = loadJsonl(file)
    this.byId = new Map(this.traces.map(trace => [trace.id, trace]))
  }

  /**
   * Add one trace entry and persist it as append-only JSONL.
   * 添加追踪记录，并以 append-only JSONL 方式持久化。
   */
  add(entry: Omit<TraceEntry, 'id' | 'timestamp'>): TraceEntry {
    const trace: TraceEntry = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    }

    appendJsonl(this.file, trace)
    this.traces.push(trace)
    this.byId.set(trace.id, trace)
    return trace
  }

  /**
   * Get one trace by id.
   * 按 id 获取单条追踪记录。
   */
  get(id: string): TraceEntry | null {
    return this.byId.get(id) ?? null
  }

  /**
   * List traces under one tenant.
   * 按租户列出追踪记录。
   */
  listByTenant(tenantId: string, limit?: number): TraceEntry[] {
    return newestFirst(
      this.traces.filter(trace => trace.tenantId === tenantId),
      limit,
    )
  }

  /**
   * List traces created by one actor.
   * 按执行者列出追踪记录。
   */
  listByActor(actorId: string, limit?: number): TraceEntry[] {
    return newestFirst(
      this.traces.filter(trace => trace.actorId === actorId),
      limit,
    )
  }

  /**
   * List traces pointing to one target entity.
   * 按目标实体列出追踪记录。
   */
  listByTarget(targetId: string, limit?: number): TraceEntry[] {
    return newestFirst(
      this.traces.filter(trace => trace.targetId === targetId),
      limit,
    )
  }

  /**
   * Follow parentTraceId upward and return the full chain.
   * 沿 parentTraceId 向上追溯，返回完整链路。
   */
  getChain(traceId: string): TraceEntry[] {
    const chain: TraceEntry[] = []
    const visited = new Set<string>()
    let current = this.get(traceId)

    while (current && !visited.has(current.id)) {
      chain.push(current)
      visited.add(current.id)
      current = current.parentTraceId ? this.get(current.parentTraceId) : null
    }

    return chain.reverse()
  }

  /**
   * Search traces by structured conditions.
   * 按结构化条件搜索追踪记录。
   */
  search(query: TraceSearchQuery, limit?: number): TraceEntry[] {
    const { tenantId, type, action, from, to } = query

    return newestFirst(
      this.traces.filter(trace => {
        if (tenantId && trace.tenantId !== tenantId) return false
        if (type && trace.type !== type) return false
        if (action && trace.action !== action) return false
        if (typeof from === 'number' && trace.timestamp < from) return false
        if (typeof to === 'number' && trace.timestamp > to) return false
        return true
      }),
      limit,
    )
  }
}

export const traceStore = new TraceStore()
