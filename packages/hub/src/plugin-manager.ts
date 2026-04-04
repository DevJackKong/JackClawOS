/**
 * JackClaw PluginManager — load/unload/sandbox plugins
 *
 * Plugins communicate ONLY through the EventBus.
 * They cannot directly access Hub internals.
 *
 * Plugin lifecycle:
 *   1. Load: PluginManager calls plugin.init(api)
 *   2. Run: Plugin subscribes to events via api.on()
 *   3. Unload: PluginManager calls plugin.destroy(), removes all subscriptions
 */

import { eventBus, EventPayload } from './event-bus'

// ─── Plugin Interface ─────────────────────────────────────────────────────────

export interface PluginManifest {
  name: string
  version: string
  description: string
  author?: string
  /** Events this plugin wants to subscribe to */
  events?: string[]
  /** Permissions required */
  permissions?: PluginPermission[]
}

export type PluginPermission =
  | 'messages.read'
  | 'messages.write'
  | 'store.read'
  | 'store.write'
  | 'network.outbound'
  | 'users.read'
  | 'tasks.manage'
  | 'system.admin'

export interface PluginAPI {
  /** Subscribe to an event */
  on(pattern: string, handler: (event: EventPayload) => void | Promise<void>): string
  /** Emit an event */
  emit(type: string, data: unknown): void
  /** Log a message */
  log(level: 'info' | 'warn' | 'error', message: string, ...args: unknown[]): void
  /** Get plugin config */
  getConfig<T>(key: string, defaultValue: T): T
  /** Store/retrieve plugin-specific data */
  store: {
    get(key: string): unknown
    set(key: string, value: unknown): void
    delete(key: string): void
  }
}

export interface JackClawPlugin {
  manifest: PluginManifest
  /** Initialize the plugin with sandboxed API */
  init(api: PluginAPI): void | Promise<void>
  /** Cleanup on unload */
  destroy?(): void | Promise<void>
}

// ─── Plugin Instance ──────────────────────────────────────────────────────────

interface PluginInstance {
  plugin: JackClawPlugin
  api: PluginAPI
  subscriptionIds: string[]
  loadedAt: number
  store: Map<string, unknown>
  enabled: boolean
}

// ─── PluginManager ────────────────────────────────────────────────────────────

export class PluginManager {
  private plugins = new Map<string, PluginInstance>()
  private config = new Map<string, Record<string, unknown>>()

  /**
   * Register and initialize a plugin.
   */
  async load(plugin: JackClawPlugin): Promise<void> {
    const name = plugin.manifest.name

    if (this.plugins.has(name)) {
      throw new Error(`Plugin "${name}" is already loaded`)
    }

    const store = new Map<string, unknown>()
    const subscriptionIds: string[] = []

    // Create sandboxed API
    const api: PluginAPI = {
      on: (pattern, handler) => {
        const id = eventBus.on(pattern, handler, name)
        subscriptionIds.push(id)
        return id
      },
      emit: (type, data) => {
        eventBus.emit(`plugin.${name}.${type}`, data, name)
      },
      log: (level, message, ...args) => {
        const prefix = `[plugin:${name}]`
        switch (level) {
          case 'info': console.log(prefix, message, ...args); break
          case 'warn': console.warn(prefix, message, ...args); break
          case 'error': console.error(prefix, message, ...args); break
        }
      },
      getConfig: <T>(key: string, defaultValue: T): T => {
        const pluginConfig = this.config.get(name) ?? {}
        return (pluginConfig[key] as T) ?? defaultValue
      },
      store: {
        get: (key) => store.get(key),
        set: (key, value) => store.set(key, value),
        delete: (key) => store.delete(key),
      },
    }

    const instance: PluginInstance = {
      plugin,
      api,
      subscriptionIds,
      loadedAt: Date.now(),
      store,
      enabled: true,
    }

    try {
      await plugin.init(api)
      this.plugins.set(name, instance)
      eventBus.emit('plugin.loaded', { name, version: plugin.manifest.version }, 'plugin-manager')
      console.log(`[plugin-manager] ✅ Loaded: ${name}@${plugin.manifest.version}`)
    } catch (err) {
      // Cleanup any subscriptions created during failed init
      for (const id of subscriptionIds) eventBus.off(id)
      throw new Error(`Plugin "${name}" init failed: ${(err as Error).message}`)
    }
  }

  /**
   * Unload a plugin and remove all its subscriptions.
   */
  async unload(name: string): Promise<void> {
    const instance = this.plugins.get(name)
    if (!instance) {
      throw new Error(`Plugin "${name}" is not loaded`)
    }

    try {
      await instance.plugin.destroy?.()
    } catch (err) {
      console.warn(`[plugin-manager] Plugin "${name}" destroy error:`, err)
    }

    // Remove all subscriptions
    eventBus.offPlugin(name)
    this.plugins.delete(name)
    eventBus.emit('plugin.unloaded', { name }, 'plugin-manager')
    console.log(`[plugin-manager] ❌ Unloaded: ${name}`)
  }

  /**
   * List all loaded plugins.
   */
  list(): PluginManifest[] {
    return [...this.plugins.values()].map(i => ({
      ...i.plugin.manifest,
    }))
  }

  /**
   * Get a specific plugin instance.
   */
  get(name: string): PluginInstance | undefined {
    return this.plugins.get(name)
  }

  /**
   * Set plugin configuration.
   */
  setConfig(pluginName: string, config: Record<string, unknown>): void {
    this.config.set(pluginName, config)
  }

  /**
   * Get stats.
   */
  getStats(): { totalPlugins: number; pluginNames: string[]; totalSubscriptions: number } {
    return {
      totalPlugins: this.plugins.size,
      pluginNames: [...this.plugins.keys()],
      totalSubscriptions: eventBus.subscriptionCount,
    }
  }
}

/** Singleton PluginManager */
export const pluginManager = new PluginManager()
