/**
 * 插件清单 / Plugin manifest metadata.
 */
export interface PluginManifest {
  id: string
  name: string
  version: string
  description?: string
  author?: string
  hooks: string[]
  permissions?: string[]
  config?: Record<string, unknown>
}

/**
 * 插件实例状态 / Runtime plugin instance state.
 */
export interface PluginInstance {
  manifest: PluginManifest
  status: 'loaded' | 'active' | 'disabled' | 'error'
  loadedAt: number
  error?: string
}

/**
 * 插件 Hook 处理器 / Plugin hook handler.
 */
export type PluginHookHandler = (event: {
  type: string
  data: unknown
  source?: string
}) => void | Promise<void>

/**
 * 插件定义 / Plugin contract.
 */
export interface Plugin {
  manifest: PluginManifest
  onLoad?: () => void | Promise<void>
  onUnload?: () => void | Promise<void>
  hooks: Record<string, PluginHookHandler>
}

interface RegisteredPlugin {
  plugin: Plugin
  instance: PluginInstance
}

/**
 * JackClaw Hub 插件系统核心。
 * Core plugin system for JackClaw Hub.
 *
 * 设计原则 / Design goals:
 * - 不依赖 eventBus，保持模块独立
 * - 插件通过 invokeHook 手动触发 Hook
 * - register / enable / disable 保持同步 API
 * - onLoad / onUnload 支持异步，但内部安全执行
 */
export class PluginSystem {
  private readonly plugins = new Map<string, RegisteredPlugin>()

  /**
   * 注册插件。
   * Register a plugin.
   */
  register(plugin: Plugin): PluginInstance {
    this.validatePlugin(plugin)

    const pluginId = plugin.manifest.id.trim()
    if (this.plugins.has(pluginId)) {
      throw new Error(`[plugin-system] Plugin "${pluginId}" already registered`)
    }

    const manifest: PluginManifest = {
      ...plugin.manifest,
      id: pluginId,
      name: plugin.manifest.name.trim(),
      version: plugin.manifest.version.trim(),
      hooks: Array.from(new Set(plugin.manifest.hooks.map(hook => hook.trim()).filter(Boolean))),
    }

    const instance: PluginInstance = {
      manifest,
      status: 'loaded',
      loadedAt: Date.now(),
    }

    this.plugins.set(pluginId, {
      plugin: {
        ...plugin,
        manifest,
      },
      instance,
    })

    instance.status = 'active'
    void this.runOnLoad(pluginId)

    return instance
  }

  /**
   * 注销插件。
   * Unregister a plugin.
   */
  unregister(pluginId: string): boolean {
    const registered = this.plugins.get(pluginId)
    if (!registered) return false

    void this.runOnUnload(pluginId)
    this.plugins.delete(pluginId)
    return true
  }

  /**
   * 启用插件。
   * Enable a plugin.
   */
  enable(pluginId: string): PluginInstance {
    const registered = this.requirePlugin(pluginId)

    if (registered.instance.status === 'active') {
      return registered.instance
    }

    registered.instance.status = 'active'
    registered.instance.error = undefined
    void this.runOnLoad(pluginId)
    return registered.instance
  }

  /**
   * 禁用插件。
   * Disable a plugin.
   */
  disable(pluginId: string): PluginInstance {
    const registered = this.requirePlugin(pluginId)

    if (registered.instance.status === 'disabled') {
      return registered.instance
    }

    registered.instance.status = 'disabled'
    void this.runOnUnload(pluginId)
    return registered.instance
  }

  /**
   * 获取插件实例。
   * Get one plugin instance.
   */
  getPlugin(pluginId: string): PluginInstance | null {
    return this.plugins.get(pluginId)?.instance ?? null
  }

  /**
   * 列出全部插件。
   * List all plugin instances.
   */
  listPlugins(): PluginInstance[] {
    return Array.from(this.plugins.values(), ({ instance }) => instance)
  }

  /**
   * 按 Hook 名称筛选插件。
   * List plugins by hook name.
   */
  listByHook(hookName: string): PluginInstance[] {
    return this.listPlugins().filter(instance => instance.manifest.hooks.includes(hookName))
  }

  /**
   * 手动触发 Hook。
   * Invoke a hook across all active plugins.
   */
  async invokeHook(
    hookName: string,
    event: { type: string; data: unknown; source?: string },
  ): Promise<void> {
    const targets = Array.from(this.plugins.values()).filter(({ instance, plugin }) => {
      return instance.status === 'active' && !!plugin.hooks[hookName] && instance.manifest.hooks.includes(hookName)
    })

    for (const { plugin, instance } of targets) {
      try {
        await plugin.hooks[hookName](event)
      } catch (error) {
        instance.status = 'error'
        instance.error = error instanceof Error ? error.message : String(error)
        console.error(`[plugin-system] Hook error in ${instance.manifest.id}:${hookName}`, error)
      }
    }
  }

  /**
   * 校验插件定义。
   * Validate plugin definition.
   */
  private validatePlugin(plugin: Plugin): void {
    const { manifest } = plugin

    if (!manifest?.id?.trim()) {
      throw new Error('[plugin-system] Plugin manifest.id is required')
    }

    if (!manifest.name?.trim()) {
      throw new Error(`[plugin-system] Plugin "${manifest.id}" manifest.name is required`)
    }

    if (!manifest.version?.trim()) {
      throw new Error(`[plugin-system] Plugin "${manifest.id}" manifest.version is required`)
    }

    if (!Array.isArray(manifest.hooks)) {
      throw new Error(`[plugin-system] Plugin "${manifest.id}" manifest.hooks must be an array`)
    }

    for (const hookName of manifest.hooks) {
      const normalizedHook = hookName?.trim()
      if (!normalizedHook) {
        throw new Error(`[plugin-system] Plugin "${manifest.id}" contains an empty hook name`)
      }

      if (!plugin.hooks[normalizedHook]) {
        throw new Error(`[plugin-system] Plugin "${manifest.id}" missing hook handler for "${normalizedHook}"`)
      }
    }
  }

  /**
   * 获取已注册插件，不存在则抛错。
   * Get a registered plugin or throw.
   */
  private requirePlugin(pluginId: string): RegisteredPlugin {
    const registered = this.plugins.get(pluginId)
    if (!registered) {
      throw new Error(`[plugin-system] Plugin "${pluginId}" not found`)
    }
    return registered
  }

  /**
   * 安全执行 onLoad。
   * Run onLoad safely without changing public sync APIs.
   */
  private async runOnLoad(pluginId: string): Promise<void> {
    const registered = this.plugins.get(pluginId)
    if (!registered?.plugin.onLoad) return

    try {
      await registered.plugin.onLoad()
    } catch (error) {
      registered.instance.status = 'error'
      registered.instance.error = error instanceof Error ? error.message : String(error)
      console.error(`[plugin-system] onLoad error in ${pluginId}`, error)
    }
  }

  /**
   * 安全执行 onUnload。
   * Run onUnload safely without changing public sync APIs.
   */
  private async runOnUnload(pluginId: string): Promise<void> {
    const registered = this.plugins.get(pluginId)
    const onUnload = registered?.plugin.onUnload
    if (!onUnload) return

    try {
      await onUnload()
    } catch (error) {
      if (registered) {
        registered.instance.status = 'error'
        registered.instance.error = error instanceof Error ? error.message : String(error)
      }
      console.error(`[plugin-system] onUnload error in ${pluginId}`, error)
    }
  }
}

/**
 * 插件系统单例。
 * Singleton plugin system instance.
 */
export const pluginSystem = new PluginSystem()
