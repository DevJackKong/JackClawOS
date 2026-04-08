"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pluginSystem = exports.PluginSystem = void 0;
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
class PluginSystem {
    plugins = new Map();
    /**
     * 注册插件。
     * Register a plugin.
     */
    register(plugin) {
        this.validatePlugin(plugin);
        const pluginId = plugin.manifest.id.trim();
        if (this.plugins.has(pluginId)) {
            throw new Error(`[plugin-system] Plugin "${pluginId}" already registered`);
        }
        const manifest = {
            ...plugin.manifest,
            id: pluginId,
            name: plugin.manifest.name.trim(),
            version: plugin.manifest.version.trim(),
            hooks: Array.from(new Set(plugin.manifest.hooks.map(hook => hook.trim()).filter(Boolean))),
        };
        const instance = {
            manifest,
            status: 'loaded',
            loadedAt: Date.now(),
        };
        this.plugins.set(pluginId, {
            plugin: {
                ...plugin,
                manifest,
            },
            instance,
        });
        instance.status = 'active';
        void this.runOnLoad(pluginId);
        return instance;
    }
    /**
     * 注销插件。
     * Unregister a plugin.
     */
    unregister(pluginId) {
        const registered = this.plugins.get(pluginId);
        if (!registered)
            return false;
        void this.runOnUnload(pluginId);
        this.plugins.delete(pluginId);
        return true;
    }
    /**
     * 启用插件。
     * Enable a plugin.
     */
    enable(pluginId) {
        const registered = this.requirePlugin(pluginId);
        if (registered.instance.status === 'active') {
            return registered.instance;
        }
        registered.instance.status = 'active';
        registered.instance.error = undefined;
        void this.runOnLoad(pluginId);
        return registered.instance;
    }
    /**
     * 禁用插件。
     * Disable a plugin.
     */
    disable(pluginId) {
        const registered = this.requirePlugin(pluginId);
        if (registered.instance.status === 'disabled') {
            return registered.instance;
        }
        registered.instance.status = 'disabled';
        void this.runOnUnload(pluginId);
        return registered.instance;
    }
    /**
     * 获取插件实例。
     * Get one plugin instance.
     */
    getPlugin(pluginId) {
        return this.plugins.get(pluginId)?.instance ?? null;
    }
    /**
     * 列出全部插件。
     * List all plugin instances.
     */
    listPlugins() {
        return Array.from(this.plugins.values(), ({ instance }) => instance);
    }
    /**
     * 按 Hook 名称筛选插件。
     * List plugins by hook name.
     */
    listByHook(hookName) {
        return this.listPlugins().filter(instance => instance.manifest.hooks.includes(hookName));
    }
    /**
     * 手动触发 Hook。
     * Invoke a hook across all active plugins.
     */
    async invokeHook(hookName, event) {
        const targets = Array.from(this.plugins.values()).filter(({ instance, plugin }) => {
            return instance.status === 'active' && !!plugin.hooks[hookName] && instance.manifest.hooks.includes(hookName);
        });
        for (const { plugin, instance } of targets) {
            try {
                await plugin.hooks[hookName](event);
            }
            catch (error) {
                instance.status = 'error';
                instance.error = error instanceof Error ? error.message : String(error);
                console.error(`[plugin-system] Hook error in ${instance.manifest.id}:${hookName}`, error);
            }
        }
    }
    /**
     * 校验插件定义。
     * Validate plugin definition.
     */
    validatePlugin(plugin) {
        const { manifest } = plugin;
        if (!manifest?.id?.trim()) {
            throw new Error('[plugin-system] Plugin manifest.id is required');
        }
        if (!manifest.name?.trim()) {
            throw new Error(`[plugin-system] Plugin "${manifest.id}" manifest.name is required`);
        }
        if (!manifest.version?.trim()) {
            throw new Error(`[plugin-system] Plugin "${manifest.id}" manifest.version is required`);
        }
        if (!Array.isArray(manifest.hooks)) {
            throw new Error(`[plugin-system] Plugin "${manifest.id}" manifest.hooks must be an array`);
        }
        for (const hookName of manifest.hooks) {
            const normalizedHook = hookName?.trim();
            if (!normalizedHook) {
                throw new Error(`[plugin-system] Plugin "${manifest.id}" contains an empty hook name`);
            }
            if (!plugin.hooks[normalizedHook]) {
                throw new Error(`[plugin-system] Plugin "${manifest.id}" missing hook handler for "${normalizedHook}"`);
            }
        }
    }
    /**
     * 获取已注册插件，不存在则抛错。
     * Get a registered plugin or throw.
     */
    requirePlugin(pluginId) {
        const registered = this.plugins.get(pluginId);
        if (!registered) {
            throw new Error(`[plugin-system] Plugin "${pluginId}" not found`);
        }
        return registered;
    }
    /**
     * 安全执行 onLoad。
     * Run onLoad safely without changing public sync APIs.
     */
    async runOnLoad(pluginId) {
        const registered = this.plugins.get(pluginId);
        if (!registered?.plugin.onLoad)
            return;
        try {
            await registered.plugin.onLoad();
        }
        catch (error) {
            registered.instance.status = 'error';
            registered.instance.error = error instanceof Error ? error.message : String(error);
            console.error(`[plugin-system] onLoad error in ${pluginId}`, error);
        }
    }
    /**
     * 安全执行 onUnload。
     * Run onUnload safely without changing public sync APIs.
     */
    async runOnUnload(pluginId) {
        const registered = this.plugins.get(pluginId);
        const onUnload = registered?.plugin.onUnload;
        if (!onUnload)
            return;
        try {
            await onUnload();
        }
        catch (error) {
            if (registered) {
                registered.instance.status = 'error';
                registered.instance.error = error instanceof Error ? error.message : String(error);
            }
            console.error(`[plugin-system] onUnload error in ${pluginId}`, error);
        }
    }
}
exports.PluginSystem = PluginSystem;
/**
 * 插件系统单例。
 * Singleton plugin system instance.
 */
exports.pluginSystem = new PluginSystem();
//# sourceMappingURL=plugin-system.js.map