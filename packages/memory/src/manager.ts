// MemoryManager — 基于4分类记忆体系的文件存储实现
// 存储路径：~/.jackclaw/memory/<nodeId>/
//   private.json  — private scope
//   shared.json   — shared scope
//   teaching/<sessionId>.json — teaching scope

import fs from 'fs'
import path from 'path'
import os from 'os'
import type {
  MemDir,
  MemoryType,
  MemoryScope,
  MemoryStats,
  MemDirQueryOptions,
} from './types.js'

const MEMORY_ROOT = path.join(os.homedir(), '.jackclaw', 'memory')
const MAX_ENTRIES = 200
const MAX_BYTES = 25 * 1024 // 25KB
const STALE_DAYS = 30

// 优先级：feedback > user > project > reference
const TYPE_PRIORITY: Record<MemoryType, number> = {
  feedback: 4,
  user: 3,
  project: 2,
  reference: 1,
}

function nodeDir(nodeId: string): string {
  return path.join(MEMORY_ROOT, nodeId)
}

function scopeFile(nodeId: string, scope: 'private' | 'shared'): string {
  return path.join(nodeDir(nodeId), `${scope}.json`)
}

function teachingFile(nodeId: string, sessionId: string): string {
  return path.join(nodeDir(nodeId), 'teaching', `${sessionId}.json`)
}

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function readJson<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return []
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as T[]
  } catch {
    return []
  }
}

function writeJson<T>(filePath: string, data: T[]): void {
  ensureDir(filePath)
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 加载 nodeId 的所有非teaching记忆 */
function loadAll(nodeId: string): MemDir[] {
  const privates = readJson<MemDir>(scopeFile(nodeId, 'private'))
  const shared = readJson<MemDir>(scopeFile(nodeId, 'shared'))
  return [...privates, ...shared]
}

/** 加载 nodeId 的特定 scope 记忆 */
function loadScope(nodeId: string, scope: 'private' | 'shared'): MemDir[] {
  return readJson<MemDir>(scopeFile(nodeId, scope))
}

/** 保存特定 scope 的记忆列表 */
function saveScope(nodeId: string, scope: 'private' | 'shared', entries: MemDir[]): void {
  writeJson(scopeFile(nodeId, scope), entries)
}

/** 压缩：按优先级升序排列，删掉末尾低优先级条目直到满足限制 */
function compress(entries: MemDir[], targetCount: number): MemDir[] {
  const sorted = [...entries].sort((a, b) => {
    const pa = TYPE_PRIORITY[a.type] ?? 0
    const pb = TYPE_PRIORITY[b.type] ?? 0
    if (pa !== pb) return pa - pb // 低优先级排前面（候选删除）
    return a.updatedAt - b.updatedAt // 旧的排前面
  })
  return sorted.slice(sorted.length - targetCount)
}

export class MemoryManager {
  /**
   * 保存记忆。feedback 类型必须有 why 字段。
   * 超出 200条/25KB 时自动压缩低优先级条目。
   */
  save(entry: Omit<MemDir, 'id' | 'createdAt' | 'updatedAt'>): MemDir {
    if (entry.type === 'feedback' && !entry.why) {
      throw new Error('feedback type requires why field')
    }
    if (entry.scope === 'teaching' && !entry.teachingSessionId) {
      throw new Error('teaching scope requires teachingSessionId')
    }

    const now = Date.now()
    const newEntry: MemDir = {
      id: generateId(),
      createdAt: now,
      updatedAt: now,
      ...entry,
    }

    if (newEntry.scope === 'teaching') {
      const filePath = teachingFile(newEntry.nodeId, newEntry.teachingSessionId!)
      const existing = readJson<MemDir>(filePath)
      existing.push(newEntry)
      writeJson(filePath, existing)
      return newEntry
    }

    const scope = newEntry.scope as 'private' | 'shared'
    let entries = loadScope(newEntry.nodeId, scope)

    // 检查是否已存在同id（更新）
    const idx = entries.findIndex(e => e.id === newEntry.id)
    if (idx >= 0) {
      entries[idx] = newEntry
    } else {
      entries.push(newEntry)
    }

    // 检查是否需要压缩
    const totalJson = JSON.stringify(entries)
    if (entries.length > MAX_ENTRIES || Buffer.byteLength(totalJson, 'utf-8') > MAX_BYTES) {
      const targetCount = Math.min(MAX_ENTRIES - 10, Math.floor(entries.length * 0.8))
      entries = compress(entries, Math.max(targetCount, 1))
    }

    saveScope(newEntry.nodeId, scope, entries)
    return newEntry
  }

  /**
   * 查询记忆，支持 type/scope/limit/tags 过滤。
   * 不传 scope 则返回 private + shared（不含 teaching）。
   */
  query(nodeId: string, opts: MemDirQueryOptions = {}): MemDir[] {
    let entries: MemDir[]

    if (opts.scope === 'teaching') {
      // 返回所有 teaching session 的记忆
      const teachDir = path.join(nodeDir(nodeId), 'teaching')
      if (!fs.existsSync(teachDir)) return []
      const files = fs.readdirSync(teachDir).filter(f => f.endsWith('.json'))
      entries = files.flatMap(f =>
        readJson<MemDir>(path.join(teachDir, f))
      )
    } else if (opts.scope === 'private' || opts.scope === 'shared') {
      entries = loadScope(nodeId, opts.scope)
    } else {
      entries = loadAll(nodeId)
    }

    if (opts.type) {
      entries = entries.filter(e => e.type === opts.type)
    }

    if (opts.tags?.length) {
      entries = entries.filter(e =>
        opts.tags!.every(t => e.tags?.includes(t))
      )
    }

    // 按更新时间降序
    entries.sort((a, b) => b.updatedAt - a.updatedAt)

    if (opts.limit) {
      entries = entries.slice(0, opts.limit)
    }

    return entries
  }

  /** 删除记忆（按 id） */
  delete(id: string): void {
    // 需要扫描所有可能的文件
    // 实际使用中 nodeId 应由调用者传入，此处提供全局扫描版本
    if (!fs.existsSync(MEMORY_ROOT)) return

    const nodeDirs = fs.readdirSync(MEMORY_ROOT, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)

    for (const nodeId of nodeDirs) {
      for (const scope of ['private', 'shared'] as const) {
        const filePath = scopeFile(nodeId, scope)
        const entries = loadScope(nodeId, scope)
        const filtered = entries.filter(e => e.id !== id)
        if (filtered.length !== entries.length) {
          saveScope(nodeId, scope, filtered)
          return
        }
      }
      // 检查 teaching
      const teachDir = path.join(nodeDir(nodeId), 'teaching')
      if (fs.existsSync(teachDir)) {
        for (const file of fs.readdirSync(teachDir).filter(f => f.endsWith('.json'))) {
          const filePath = path.join(teachDir, file)
          const entries = readJson<MemDir>(filePath)
          const filtered = entries.filter(e => e.id !== id)
          if (filtered.length !== entries.length) {
            writeJson(filePath, filtered)
            return
          }
        }
      }
    }
  }

  /** 按 nodeId + id 删除（高效版） */
  deleteFromNode(nodeId: string, id: string): void {
    for (const scope of ['private', 'shared'] as const) {
      const entries = loadScope(nodeId, scope)
      const filtered = entries.filter(e => e.id !== id)
      if (filtered.length !== entries.length) {
        saveScope(nodeId, scope, filtered)
        return
      }
    }
    const teachDir = path.join(nodeDir(nodeId), 'teaching')
    if (fs.existsSync(teachDir)) {
      for (const file of fs.readdirSync(teachDir).filter(f => f.endsWith('.json'))) {
        const filePath = path.join(teachDir, file)
        const entries = readJson<MemDir>(filePath)
        const filtered = entries.filter(e => e.id !== id)
        if (filtered.length !== entries.length) {
          writeJson(filePath, filtered)
          return
        }
      }
    }
  }

  /** 统计 nodeId 的记忆情况 */
  stats(nodeId: string): MemoryStats {
    const allEntries = loadAll(nodeId)
    const teachDir = path.join(nodeDir(nodeId), 'teaching')
    let teachingEntries: MemDir[] = []
    if (fs.existsSync(teachDir)) {
      const files = fs.readdirSync(teachDir).filter(f => f.endsWith('.json'))
      teachingEntries = files.flatMap(f =>
        readJson<MemDir>(path.join(teachDir, f))
      )
    }
    const all = [...allEntries, ...teachingEntries]

    const totalChars = all.reduce((sum, e) => sum + e.content.length, 0)
    const totalBytes = Buffer.byteLength(JSON.stringify(allEntries), 'utf-8')

    const byType: Record<MemoryType, number> = {
      user: 0, feedback: 0, project: 0, reference: 0,
    }
    const byScope: Record<MemoryScope, number> = {
      private: 0, shared: 0, teaching: 0,
    }

    for (const e of all) {
      byType[e.type] = (byType[e.type] ?? 0) + 1
      byScope[e.scope] = (byScope[e.scope] ?? 0) + 1
    }

    return {
      totalEntries: all.length,
      totalChars,
      byType,
      byScope,
      limitWarning: allEntries.length > MAX_ENTRIES || totalBytes > MAX_BYTES,
    }
  }

  /** 清除某个 teaching session 的所有记忆 */
  clearTeachingMemory(nodeId: string, sessionId: string): void {
    const filePath = teachingFile(nodeId, sessionId)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  }

  /**
   * 生成适合同步到 Hub 的摘要（仅 shared scope）
   * 返回结构化摘要，不含敏感私有数据
   */
  syncSummary(nodeId: string): { nodeId: string; entries: MemDir[]; generatedAt: number } {
    const shared = loadScope(nodeId, 'shared')
    return {
      nodeId,
      entries: shared,
      generatedAt: Date.now(),
    }
  }

  /**
   * 标记可能过时的条目（超过 STALE_DAYS 天未验证）
   * 将 verified 设为 false，不自动删除
   */
  verifyEntries(nodeId: string): { staleCount: number } {
    const cutoff = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000
    let staleCount = 0

    for (const scope of ['private', 'shared'] as const) {
      const entries = loadScope(nodeId, scope)
      let changed = false
      for (const e of entries) {
        if (e.updatedAt < cutoff && e.verified !== false) {
          e.verified = false
          changed = true
          staleCount++
        }
      }
      if (changed) saveScope(nodeId, scope, entries)
    }

    return { staleCount }
  }
}
