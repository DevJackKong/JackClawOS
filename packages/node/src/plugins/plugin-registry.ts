import fs from 'fs'
import path from 'path'

export type PluginType = 'agent' | 'tool' | 'skill' | 'hook'

export interface PluginManifest {
  id: string
  name: string
  version: string
  type: PluginType
  description: string
  author: string
  entryPoint: string
  config?: Record<string, unknown>
  permissions: string[]
  tags: string[]
}

export interface PluginInstance {
  manifest: PluginManifest
  status: 'registered' | 'active' | 'disabled' | 'error'
  registeredAt: number
  activatedAt?: number
  errorMessage?: string
}

interface PersistedPluginRegistry {
  plugins: PluginInstance[]
}

const PLUGIN_TYPES: PluginType[] = ['agent', 'tool', 'skill', 'hook']
const PLUGIN_STATUSES: PluginInstance['status'][] = ['registered', 'active', 'disabled', 'error']

export class PluginRegistry {
  private plugins: Map<string, PluginInstance> = new Map()

  register(manifest: PluginManifest): PluginInstance {
    const normalizedManifest = this.normalizeManifest(manifest)
    const now = Date.now()
    const existing = this.plugins.get(normalizedManifest.id)

    const plugin: PluginInstance = {
      manifest: normalizedManifest,
      status: existing?.status === 'active' ? 'active' : 'registered',
      registeredAt: existing?.registeredAt ?? now,
      activatedAt: existing?.status === 'active' ? (existing.activatedAt ?? now) : undefined,
      errorMessage: undefined,
    }

    this.plugins.set(normalizedManifest.id, plugin)
    return this.cloneInstance(plugin)
  }

  activate(pluginId: string): PluginInstance {
    const plugin = this.requirePlugin(pluginId)
    const activated: PluginInstance = {
      ...plugin,
      status: 'active',
      activatedAt: Date.now(),
      errorMessage: undefined,
      manifest: this.cloneManifest(plugin.manifest),
    }

    this.plugins.set(pluginId, activated)
    return this.cloneInstance(activated)
  }

  disable(pluginId: string): PluginInstance {
    const plugin = this.requirePlugin(pluginId)
    const disabled: PluginInstance = {
      ...plugin,
      status: 'disabled',
      errorMessage: undefined,
      manifest: this.cloneManifest(plugin.manifest),
    }

    this.plugins.set(pluginId, disabled)
    return this.cloneInstance(disabled)
  }

  unregister(pluginId: string): void {
    if (!this.plugins.delete(pluginId)) {
      throw new Error(`Plugin not found: ${pluginId}`)
    }
  }

  get(pluginId: string): PluginInstance | null {
    const plugin = this.plugins.get(pluginId)
    return plugin ? this.cloneInstance(plugin) : null
  }

  findByType(type: PluginType): PluginInstance[] {
    this.assertPluginType(type)
    return this.listFrom(this.plugins.values()).filter((plugin) => plugin.manifest.type === type)
  }

  findByTag(tag: string): PluginInstance[] {
    const normalizedTag = this.normalizeTag(tag)
    return this.listFrom(this.plugins.values()).filter((plugin) =>
      plugin.manifest.tags.some((item) => this.normalizeTag(item) === normalizedTag),
    )
  }

  listAll(): PluginInstance[] {
    return this.listFrom(this.plugins.values())
  }

  getActive(): PluginInstance[] {
    return this.listFrom(this.plugins.values()).filter((plugin) => plugin.status === 'active')
  }

  save(filePath: string): void {
    const resolvedPath = path.resolve(filePath)
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true })

    const payload: PersistedPluginRegistry = {
      plugins: Array.from(this.plugins.values())
        .map((plugin) => this.cloneInstance(plugin))
        .sort((a, b) => a.manifest.id.localeCompare(b.manifest.id)),
    }

    fs.writeFileSync(resolvedPath, JSON.stringify(payload, null, 2), 'utf8')
  }

  load(filePath: string): void {
    const resolvedPath = path.resolve(filePath)
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Plugin registry file not found: ${resolvedPath}`)
    }

    const raw = fs.readFileSync(resolvedPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<PersistedPluginRegistry>
    const plugins = Array.isArray(parsed.plugins) ? parsed.plugins : []
    const next = new Map<string, PluginInstance>()

    for (const plugin of plugins) {
      const validated = this.validateLoadedInstance(plugin)
      next.set(validated.manifest.id, validated)
    }

    this.plugins = next
  }

  private listFrom(plugins: Iterable<PluginInstance>): PluginInstance[] {
    return Array.from(plugins, (plugin) => this.cloneInstance(plugin)).sort((a, b) =>
      a.manifest.id.localeCompare(b.manifest.id),
    )
  }

  private requirePlugin(pluginId: string): PluginInstance {
    const plugin = this.plugins.get(pluginId)
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}`)
    }
    return plugin
  }

  private normalizeManifest(manifest: PluginManifest): PluginManifest {
    if (!manifest || typeof manifest !== 'object') {
      throw new Error('Plugin manifest is required')
    }

    const normalized: PluginManifest = {
      id: this.requireNonEmptyString(manifest.id, 'manifest.id'),
      name: this.requireNonEmptyString(manifest.name, 'manifest.name'),
      version: this.requireNonEmptyString(manifest.version, 'manifest.version'),
      type: manifest.type,
      description: this.requireNonEmptyString(manifest.description, 'manifest.description'),
      author: this.requireNonEmptyString(manifest.author, 'manifest.author'),
      entryPoint: this.requireNonEmptyString(manifest.entryPoint, 'manifest.entryPoint'),
      config: this.normalizeConfig(manifest.config),
      permissions: this.normalizeStringArray(manifest.permissions, 'manifest.permissions'),
      tags: this.normalizeStringArray(manifest.tags, 'manifest.tags'),
    }

    this.assertPluginType(normalized.type)
    return normalized
  }

  private validateLoadedInstance(plugin: PluginInstance): PluginInstance {
    if (!plugin || typeof plugin !== 'object') {
      throw new Error('Invalid plugin instance in registry file')
    }

    const manifest = this.normalizeManifest(plugin.manifest)
    const status = plugin.status
    if (!PLUGIN_STATUSES.includes(status)) {
      throw new Error(`Invalid plugin status: ${String(status)}`)
    }

    const registeredAt = this.requireFiniteNumber(plugin.registeredAt, `plugin(${manifest.id}).registeredAt`)
    const activatedAt =
      plugin.activatedAt === undefined
        ? undefined
        : this.requireFiniteNumber(plugin.activatedAt, `plugin(${manifest.id}).activatedAt`)
    const errorMessage =
      plugin.errorMessage === undefined ? undefined : this.requireNonEmptyString(plugin.errorMessage, `plugin(${manifest.id}).errorMessage`)

    return {
      manifest,
      status,
      registeredAt,
      activatedAt,
      errorMessage,
    }
  }

  private cloneInstance(plugin: PluginInstance): PluginInstance {
    return {
      manifest: this.cloneManifest(plugin.manifest),
      status: plugin.status,
      registeredAt: plugin.registeredAt,
      activatedAt: plugin.activatedAt,
      errorMessage: plugin.errorMessage,
    }
  }

  private cloneManifest(manifest: PluginManifest): PluginManifest {
    return {
      ...manifest,
      config: manifest.config ? { ...manifest.config } : undefined,
      permissions: [...manifest.permissions],
      tags: [...manifest.tags],
    }
  }

  private normalizeConfig(config: PluginManifest['config']): Record<string, unknown> | undefined {
    if (config === undefined) return undefined
    if (!config || Array.isArray(config) || typeof config !== 'object') {
      throw new Error('manifest.config must be an object when provided')
    }
    return { ...config }
  }

  private normalizeStringArray(value: string[], field: string): string[] {
    if (!Array.isArray(value)) {
      throw new Error(`${field} must be an array`)
    }

    const seen = new Set<string>()
    const normalized: string[] = []

    for (const item of value) {
      const next = this.requireNonEmptyString(item, field)
      if (!seen.has(next)) {
        seen.add(next)
        normalized.push(next)
      }
    }

    return normalized
  }

  private normalizeTag(tag: string): string {
    return this.requireNonEmptyString(tag, 'tag').toLowerCase()
  }

  private requireNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== 'string') {
      throw new Error(`${field} must be a string`)
    }

    const trimmed = value.trim()
    if (!trimmed) {
      throw new Error(`${field} cannot be empty`)
    }

    return trimmed
  }

  private requireFiniteNumber(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${field} must be a finite number`)
    }
    return value
  }

  private assertPluginType(type: PluginType): void {
    if (!PLUGIN_TYPES.includes(type)) {
      throw new Error(`Invalid plugin type: ${String(type)}`)
    }
  }
}
