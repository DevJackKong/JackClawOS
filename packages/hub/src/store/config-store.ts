// JackClaw Hub - Config Store
// Persists to ~/.jackclaw/hub/config.json
// 系统/租户/组织/用户配置持久化到 ~/.jackclaw/hub/config.json

import fs from 'fs'
import path from 'path'

// ─── Paths / 路径 ───────────────────────────────────────────────────────────────

const HUB_DIR = path.join(process.env.HOME ?? '~', '.jackclaw', 'hub')
const CONFIG_FILE = path.join(HUB_DIR, 'app-config.json')

// ─── Types / 类型 ───────────────────────────────────────────────────────────────

export interface ConfigEntry {
  key: string
  value: unknown
  scope: 'system' | 'tenant' | 'org' | 'user'
  scopeId?: string          // Scope target id / 作用域目标 ID
  description?: string      // Optional description / 可选描述
  updatedBy?: string        // Last updater / 最后更新人
  updatedAt: number
}

type ConfigScope = ConfigEntry['scope']

// ─── Helpers / 工具函数 ─────────────────────────────────────────────────────────

function loadJSON<T>(file: string, fallback: T): T {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8')) as T
  } catch {
    // Ignore broken or missing file / 忽略文件不存在或损坏的情况
  }
  return fallback
}

function saveJSON(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
}

/**
 * Normalize one config entry from disk.
 * 标准化磁盘中的配置记录，兼容旧数据或脏数据。
 */
function normalizeEntry(input: Partial<ConfigEntry>): ConfigEntry | null {
  const key = typeof input.key === 'string' ? input.key.trim() : ''
  const scope = input.scope
  const scopeId = typeof input.scopeId === 'string' ? input.scopeId.trim() : undefined

  if (!key) return null
  if (scope !== 'system' && scope !== 'tenant' && scope !== 'org' && scope !== 'user') return null

  return {
    key,
    value: input.value,
    scope,
    scopeId: scopeId || undefined,
    description: typeof input.description === 'string' ? input.description : undefined,
    updatedBy: typeof input.updatedBy === 'string' ? input.updatedBy : undefined,
    updatedAt: typeof input.updatedAt === 'number' && Number.isFinite(input.updatedAt)
      ? input.updatedAt
      : Date.now(),
  }
}

/**
 * Validate scope input.
 * 校验配置作用域是否合法。
 */
function normalizeScope(scope?: string): ConfigScope {
  const normalized = (scope ?? 'system').trim() as ConfigScope
  if (normalized === 'system' || normalized === 'tenant' || normalized === 'org' || normalized === 'user') {
    return normalized
  }
  throw Object.assign(new Error(`invalid config scope: ${scope}`), { status: 400 })
}

/**
 * Build stable unique id for one entry.
 * 为单条配置生成稳定唯一键。
 */
function buildEntryId(key: string, scope: ConfigScope, scopeId?: string): string {
  return `${scope}:${scopeId ?? '*'}:${key}`
}

// ─── ConfigStore / 配置存储 ─────────────────────────────────────────────────────

export class ConfigStore {
  private readonly file: string

  constructor(file = CONFIG_FILE) {
    this.file = file
  }

  /**
   * Load all config entries from disk.
   * 从磁盘加载全部配置项。
   */
  private load(): ConfigEntry[] {
    const raw = loadJSON<unknown>(this.file, [])
    if (!Array.isArray(raw)) return []
    return (raw as Partial<ConfigEntry>[])
      .map(normalizeEntry)
      .filter((entry): entry is ConfigEntry => entry !== null)
  }

  /**
   * Persist all config entries to disk.
   * 将全部配置项写回磁盘。
   */
  private save(entries: ConfigEntry[]): void {
    saveJSON(this.file, entries)
  }

  /**
   * Find one exact config entry by key + scope + scopeId.
   * 按 key + scope + scopeId 精确查找配置项。
   */
  private findEntry(
    entries: ConfigEntry[],
    key: string,
    scope: ConfigScope = 'system',
    scopeId?: string,
  ): ConfigEntry | undefined {
    return entries.find(entry => (
      entry.key === key
      && entry.scope === scope
      && (entry.scopeId ?? '') === (scopeId ?? '')
    ))
  }

  /**
   * Get one config value by exact scope.
   * 按精确作用域读取配置值。
   */
  get(key: string, scope?: string, scopeId?: string): unknown {
    const normalizedKey = key.trim()
    if (!normalizedKey) return undefined

    const entry = this.findEntry(
      this.load(),
      normalizedKey,
      normalizeScope(scope),
      scopeId?.trim() || undefined,
    )

    return entry?.value
  }

  /**
   * Create or update one config entry.
   * 创建或更新一条配置记录。
   */
  set(
    key: string,
    value: unknown,
    scope: string,
    scopeId?: string,
    updatedBy?: string,
  ): ConfigEntry {
    const normalizedKey = key.trim()
    if (!normalizedKey) throw Object.assign(new Error('config key cannot be empty'), { status: 400 })

    const normalizedScope = normalizeScope(scope)
    const normalizedScopeId = scopeId?.trim() || undefined
    const normalizedUpdatedBy = updatedBy?.trim() || undefined
    const now = Date.now()
    const entries = this.load()
    const entryId = buildEntryId(normalizedKey, normalizedScope, normalizedScopeId)
    const existingIndex = entries.findIndex(entry => (
      buildEntryId(entry.key, entry.scope, entry.scopeId) === entryId
    ))

    const nextEntry: ConfigEntry = {
      key: normalizedKey,
      value,
      scope: normalizedScope,
      scopeId: normalizedScopeId,
      description: existingIndex >= 0 ? entries[existingIndex].description : undefined,
      updatedBy: normalizedUpdatedBy,
      updatedAt: now,
    }

    if (existingIndex >= 0) {
      entries[existingIndex] = nextEntry
    } else {
      entries.push(nextEntry)
    }

    this.save(entries)
    return nextEntry
  }

  /**
   * Delete config entries by key and optional scope filter.
   * 按 key 删除配置；可选按 scope/scopeId 限定范围。
   */
  delete(key: string, scope?: string, scopeId?: string): boolean {
    const normalizedKey = key.trim()
    if (!normalizedKey) return false

    const hasScopeFilter = scope !== undefined
    const normalizedScope = hasScopeFilter ? normalizeScope(scope) : undefined
    const normalizedScopeId = scopeId?.trim() || undefined
    const entries = this.load()

    const nextEntries = entries.filter(entry => {
      if (entry.key !== normalizedKey) return true
      if (normalizedScope !== undefined && entry.scope !== normalizedScope) return true
      if (scopeId !== undefined && (entry.scopeId ?? '') !== (normalizedScopeId ?? '')) return true
      return false
    })

    if (nextEntries.length === entries.length) return false
    this.save(nextEntries)
    return true
  }

  /**
   * List config entries with optional scope filter.
   * 列出配置项；可按 scope/scopeId 过滤。
   */
  list(scope?: string, scopeId?: string): ConfigEntry[] {
    const hasScopeFilter = scope !== undefined
    const normalizedScope = hasScopeFilter ? normalizeScope(scope) : undefined
    const normalizedScopeId = scopeId?.trim() || undefined

    return this.load()
      .filter(entry => (normalizedScope ? entry.scope === normalizedScope : true))
      .filter(entry => (scopeId !== undefined ? (entry.scopeId ?? '') === (normalizedScopeId ?? '') : true))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /**
   * Resolve effective config value by inheritance priority.
   * 按继承优先级解析最终配置：user > org > tenant > system。
   */
  getEffective(key: string, tenantId?: string, orgId?: string, userId?: string): unknown {
    const normalizedKey = key.trim()
    if (!normalizedKey) return undefined

    const entries = this.load()
    const candidates: Array<{ scope: ConfigScope; scopeId?: string }> = [
      { scope: 'user', scopeId: userId?.trim() || undefined },
      { scope: 'org', scopeId: orgId?.trim() || undefined },
      { scope: 'tenant', scopeId: tenantId?.trim() || undefined },
      { scope: 'system' },
    ]

    for (const candidate of candidates) {
      if (candidate.scope !== 'system' && !candidate.scopeId) continue
      const entry = this.findEntry(entries, normalizedKey, candidate.scope, candidate.scopeId)
      if (entry) return entry.value
    }

    return undefined
  }
}

// Singleton / 单例
export const configStore = new ConfigStore()
