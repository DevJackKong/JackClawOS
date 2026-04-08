"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.pluginManager = exports.PluginManager = void 0;
const event_bus_1 = require("./event-bus");
// ─── PluginManager ────────────────────────────────────────────────────────────
class PluginManager {
    plugins = new Map();
    config = new Map();
    /**
     * Register and initialize a plugin.
     */
    async load(plugin) {
        const name = plugin.manifest.name;
        if (this.plugins.has(name)) {
            throw new Error(`Plugin "${name}" is already loaded`);
        }
        const store = new Map();
        const subscriptionIds = [];
        // Create sandboxed API
        const api = {
            on: (pattern, handler) => {
                const id = event_bus_1.eventBus.on(pattern, handler, name);
                subscriptionIds.push(id);
                return id;
            },
            emit: (type, data) => {
                event_bus_1.eventBus.emit(`plugin.${name}.${type}`, data, name);
            },
            log: (level, message, ...args) => {
                const prefix = `[plugin:${name}]`;
                switch (level) {
                    case 'info':
                        console.log(prefix, message, ...args);
                        break;
                    case 'warn':
                        console.warn(prefix, message, ...args);
                        break;
                    case 'error':
                        console.error(prefix, message, ...args);
                        break;
                }
            },
            getConfig: (key, defaultValue) => {
                const pluginConfig = this.config.get(name) ?? {};
                return pluginConfig[key] ?? defaultValue;
            },
            store: {
                get: (key) => store.get(key),
                set: (key, value) => store.set(key, value),
                delete: (key) => store.delete(key),
            },
        };
        const instance = {
            plugin,
            api,
            subscriptionIds,
            loadedAt: Date.now(),
            store,
            enabled: true,
        };
        try {
            await plugin.init(api);
            this.plugins.set(name, instance);
            event_bus_1.eventBus.emit('plugin.loaded', { name, version: plugin.manifest.version }, 'plugin-manager');
            console.log(`[plugin-manager] ✅ Loaded: ${name}@${plugin.manifest.version}`);
        }
        catch (err) {
            // Cleanup any subscriptions created during failed init
            for (const id of subscriptionIds)
                event_bus_1.eventBus.off(id);
            throw new Error(`Plugin "${name}" init failed: ${err.message}`);
        }
    }
    /**
     * Unload a plugin and remove all its subscriptions.
     */
    async unload(name) {
        const instance = this.plugins.get(name);
        if (!instance) {
            throw new Error(`Plugin "${name}" is not loaded`);
        }
        try {
            await instance.plugin.destroy?.();
        }
        catch (err) {
            console.warn(`[plugin-manager] Plugin "${name}" destroy error:`, err);
        }
        // Remove all subscriptions
        event_bus_1.eventBus.offPlugin(name);
        this.plugins.delete(name);
        event_bus_1.eventBus.emit('plugin.unloaded', { name }, 'plugin-manager');
        console.log(`[plugin-manager] ❌ Unloaded: ${name}`);
    }
    /**
     * List all loaded plugins.
     */
    list() {
        return [...this.plugins.values()].map(i => ({
            ...i.plugin.manifest,
        }));
    }
    /**
     * Get a specific plugin instance.
     */
    get(name) {
        return this.plugins.get(name);
    }
    /**
     * Set plugin configuration.
     */
    setConfig(pluginName, config) {
        this.config.set(pluginName, config);
    }
    /**
     * Get stats.
     */
    getStats() {
        return {
            totalPlugins: this.plugins.size,
            pluginNames: [...this.plugins.keys()],
            totalSubscriptions: event_bus_1.eventBus.subscriptionCount,
        };
    }
}
exports.PluginManager = PluginManager;
/** Singleton PluginManager */
exports.pluginManager = new PluginManager();
//# sourceMappingURL=plugin-manager.js.map