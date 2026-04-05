/**
 * compact.hook.ts — JackClaw 三层记忆压缩策略
 *
 * 借鉴 Claude Code 的上下文压缩机制，将其映射到 JackClaw 节点记忆：
 *
 *   L1 autoCompact  — 节点记忆摘要压缩（超过 80% 容量触发）
 *   L2 snipCompact  — 修剪低优先级 reference 记忆（>14 天未访问）
 *   L3 crossNodeCompact — 跨节点去重（需 Hub 写权限）
 *
 * Usage:
 *   import { autoCompact, snipCompact, crossNodeCompact } from './hooks/compact.hook.js'
 */

import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface CompactResult {
  /** Number of memory entries removed */
  removed: number
  /** Approximate bytes freed */
  saved: number
  /** Which strategy ran */
  strategy: 'auto' | 'snip' | 'cross'
}

// ─── Internal Types ───────────────────────────────────────────────────────────

interface MemoryEntry {
  key: string
  value: unknown
  type?: 'reference' | 'working' | 'core'
  updatedAt: number
  lastAccessedAt?: number
  /** Rough serialized size in bytes (cached) */
  _size?: number
}

// ─── Config ───────────────────────────────────────────────────────────────────

const DEFAULT_HUB_URL = process.env['JACKCLAW_HUB_URL'] ?? 'https://hub.jackclaw.ai'
const CEO_TOKEN = process.env['JACKCLAW_CEO_TOKEN'] ?? ''

/** Default memory capacity in bytes (8 MB per node) */
const DEFAULT_CAPACITY = 8 * 1024 * 1024
/** L1 trigger threshold: 80 % of capacity */
const AUTO_COMPACT_THRESHOLD = 0.8
/** L2 snip: prune reference entries not accessed for this many ms */
const SNIP_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000 // 14 days

// ─── File helpers ─────────────────────────────────────────────────────────────

function memoryFilePath(nodeId: string): string {
  return path.join(os.homedir(), '.openclaw', 'workspace', 'memory', `shared-${nodeId}.json`)
}

async function loadEntries(nodeId: string): Promise<MemoryEntry[]> {
  try {
    const raw = await fs.readFile(memoryFilePath(nodeId), 'utf8')
    return (JSON.parse(raw) as MemoryEntry[]).map((e) => ({
      ...e,
      _size: e._size ?? Buffer.byteLength(JSON.stringify(e)),
    }))
  } catch {
    return []
  }
}

async function saveEntries(nodeId: string, entries: MemoryEntry[]): Promise<void> {
  const filePath = memoryFilePath(nodeId)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(entries, null, 2), 'utf8')
}

function totalSize(entries: MemoryEntry[]): number {
  return entries.reduce((acc, e) => acc + (e._size ?? Buffer.byteLength(JSON.stringify(e))), 0)
}

// ─── Summary helper (LLM-free fallback) ──────────────────────────────────────

/**
 * Produce a lossy text summary of an entry's value.
 * Real deployments can replace this with an LLM summarisation call.
 */
function summariseValue(value: unknown): string {
  const s = typeof value === 'string' ? value : JSON.stringify(value)
  // Keep first 120 chars as the "summary"
  return s.length > 120 ? `${s.slice(0, 117)}…` : s
}

// ─── Hub helpers ─────────────────────────────────────────────────────────────

async function hubGet<T>(path: string): Promise<T> {
  const url = `${DEFAULT_HUB_URL}${path}`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (CEO_TOKEN) headers['Authorization'] = `Bearer ${CEO_TOKEN}`
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`Hub GET ${path} → ${res.status}`)
  return res.json() as Promise<T>
}

async function hubPost<T>(path: string, body: unknown): Promise<T> {
  const url = `${DEFAULT_HUB_URL}${path}`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (CEO_TOKEN) headers['Authorization'] = `Bearer ${CEO_TOKEN}`
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`Hub POST ${path} → ${res.status}`)
  return res.json() as Promise<T>
}

// ─── L1: autoCompact ─────────────────────────────────────────────────────────

/**
 * L1 压缩 — 节点记忆摘要压缩
 *
 * 当本地记忆超过 80% 容量时触发。
 * 策略：
 *   1. 按 updatedAt 升序排列（最旧的优先压缩）
 *   2. 将 working/reference 类型条目的 value 替换为摘要文本
 *   3. core 类型条目保持原样不压缩
 *   4. 重写磁盘文件并返回节省的字节数
 */
export async function autoCompact(nodeId: string): Promise<CompactResult> {
  const entries = await loadEntries(nodeId)
  if (entries.length === 0) return { removed: 0, saved: 0, strategy: 'auto' }

  const used = totalSize(entries)
  const threshold = DEFAULT_CAPACITY * AUTO_COMPACT_THRESHOLD

  if (used < threshold) {
    return { removed: 0, saved: 0, strategy: 'auto' }
  }

  let saved = 0
  let removed = 0

  // Sort: oldest first, core entries last
  const sorted = [...entries].sort((a, b) => {
    if (a.type === 'core' && b.type !== 'core') return 1
    if (a.type !== 'core' && b.type === 'core') return -1
    return a.updatedAt - b.updatedAt
  })

  const compacted: MemoryEntry[] = sorted.map((e) => {
    if (e.type === 'core') return e

    const originalSize = e._size ?? Buffer.byteLength(JSON.stringify(e))
    const summary = summariseValue(e.value)
    const newEntry: MemoryEntry = {
      ...e,
      value: summary,
      _size: Buffer.byteLength(JSON.stringify({ ...e, value: summary })),
    }
    const newSize = newEntry._size!
    saved += Math.max(0, originalSize - newSize)
    if (newSize < originalSize) removed++ // counts as "a compaction happened"
    return newEntry
  })

  await saveEntries(nodeId, compacted)
  return { removed, saved, strategy: 'auto' }
}

// ─── L2: snipCompact ─────────────────────────────────────────────────────────

/**
 * L2 压缩 — 修剪低优先级记忆
 *
 * 删除满足以下所有条件的条目：
 *   - type === 'reference'（低优先级）
 *   - lastAccessedAt < 14 天前（长期未使用）
 *
 * 被删除的条目会先写入 .openclaw/workspace/memory/snip-archive-<nodeId>.jsonl
 * 以便审计或恢复。
 */
export async function snipCompact(nodeId: string): Promise<CompactResult> {
  const entries = await loadEntries(nodeId)
  if (entries.length === 0) return { removed: 0, saved: 0, strategy: 'snip' }

  const now = Date.now()
  const cutoff = now - SNIP_MAX_AGE_MS

  const kept: MemoryEntry[] = []
  const pruned: MemoryEntry[] = []

  for (const e of entries) {
    const isReference = e.type === 'reference'
    const lastAccess = e.lastAccessedAt ?? e.updatedAt
    const stale = lastAccess < cutoff

    if (isReference && stale) {
      pruned.push(e)
    } else {
      kept.push(e)
    }
  }

  if (pruned.length === 0) return { removed: 0, saved: 0, strategy: 'snip' }

  // Archive pruned entries (append mode)
  const archivePath = path.join(
    os.homedir(),
    '.openclaw',
    'workspace',
    'memory',
    `snip-archive-${nodeId}.jsonl`,
  )
  const archiveLines = pruned.map((e) => JSON.stringify({ ...e, _prunedAt: now })).join('\n') + '\n'
  await fs.appendFile(archivePath, archiveLines, 'utf8')

  const saved = pruned.reduce(
    (acc, e) => acc + (e._size ?? Buffer.byteLength(JSON.stringify(e))),
    0,
  )

  await saveEntries(nodeId, kept)
  return { removed: pruned.length, saved, strategy: 'snip' }
}

// ─── L3: crossNodeCompact ─────────────────────────────────────────────────────

/**
 * L3 压缩 — 跨节点记忆去重
 *
 * 需要 Hub 写权限（CEO_TOKEN）。
 *
 * 流程：
 *   1. 从 Hub 拉取所有指定节点的 shared memory
 *   2. 计算每个 entry key 的出现次数
 *   3. 对重复 key，保留最新的一份，向 Hub 发送删除指令
 *   4. 返回节省统计
 *
 * 注意：此操作会修改 Hub 上的数据，不触动本地文件。
 */
export async function crossNodeCompact(
  hubUrl: string = DEFAULT_HUB_URL,
  nodeIds: string[],
): Promise<CompactResult> {
  if (nodeIds.length < 2) return { removed: 0, saved: 0, strategy: 'cross' }

  // Fetch all nodes' shared memory from Hub
  type NodeMemory = { nodeId: string; entries: MemoryEntry[] }
  const nodeMemories: NodeMemory[] = await Promise.all(
    nodeIds.map(async (id) => {
      try {
        const data = await hubGet<{ entries: MemoryEntry[] }>(`/api/nodes/${id}/memory`)
        return { nodeId: id, entries: data.entries ?? [] }
      } catch {
        return { nodeId: id, entries: [] }
      }
    }),
  )

  // Build a map: key → [{nodeId, entry}] (all occurrences across nodes)
  const keyMap = new Map<string, Array<{ nodeId: string; entry: MemoryEntry }>>()
  for (const nm of nodeMemories) {
    for (const e of nm.entries) {
      const list = keyMap.get(e.key) ?? []
      list.push({ nodeId: nm.nodeId, entry: e })
      keyMap.set(e.key, list)
    }
  }

  // Find duplicates (same key, same JSON value across ≥2 nodes)
  const toDelete: Array<{ nodeId: string; key: string; size: number }> = []

  for (const [, occurrences] of keyMap) {
    if (occurrences.length < 2) continue

    // Group by content hash (stringify as fingerprint)
    const fingerprints = new Map<string, typeof occurrences>()
    for (const occ of occurrences) {
      const fp = JSON.stringify(occ.entry.value)
      const g = fingerprints.get(fp) ?? []
      g.push(occ)
      fingerprints.set(fp, g)
    }

    for (const [, group] of fingerprints) {
      if (group.length < 2) continue
      // Keep the newest; delete the rest
      const sorted = [...group].sort((a, b) => b.entry.updatedAt - a.entry.updatedAt)
      for (const dup of sorted.slice(1)) {
        toDelete.push({
          nodeId: dup.nodeId,
          key: dup.entry.key,
          size: dup.entry._size ?? Buffer.byteLength(JSON.stringify(dup.entry)),
        })
      }
    }
  }

  if (toDelete.length === 0) return { removed: 0, saved: 0, strategy: 'cross' }

  // Group deletions by node and send batch requests
  const byNode = new Map<string, string[]>()
  for (const d of toDelete) {
    const keys = byNode.get(d.nodeId) ?? []
    keys.push(d.key)
    byNode.set(d.nodeId, keys)
  }

  await Promise.allSettled(
    Array.from(byNode.entries()).map(([nodeId, keys]) =>
      hubPost(`/api/nodes/${nodeId}/memory/delete`, { keys }),
    ),
  )

  const saved = toDelete.reduce((acc, d) => acc + d.size, 0)
  return { removed: toDelete.length, saved, strategy: 'cross' }
}
