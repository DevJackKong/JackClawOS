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
import { EventPayload } from './event-bus';
export interface PluginManifest {
    name: string;
    version: string;
    description: string;
    author?: string;
    /** Events this plugin wants to subscribe to */
    events?: string[];
    /** Permissions required */
    permissions?: PluginPermission[];
}
export type PluginPermission = 'messages.read' | 'messages.write' | 'store.read' | 'store.write' | 'network.outbound' | 'users.read' | 'tasks.manage' | 'system.admin';
export interface PluginAPI {
    /** Subscribe to an event */
    on(pattern: string, handler: (event: EventPayload) => void | Promise<void>): string;
    /** Emit an event */
    emit(type: string, data: unknown): void;
    /** Log a message */
    log(level: 'info' | 'warn' | 'error', message: string, ...args: unknown[]): void;
    /** Get plugin config */
    getConfig<T>(key: string, defaultValue: T): T;
    /** Store/retrieve plugin-specific data */
    store: {
        get(key: string): unknown;
        set(key: string, value: unknown): void;
        delete(key: string): void;
    };
}
export interface JackClawPlugin {
    manifest: PluginManifest;
    /** Initialize the plugin with sandboxed API */
    init(api: PluginAPI): void | Promise<void>;
    /** Cleanup on unload */
    destroy?(): void | Promise<void>;
}
interface PluginInstance {
    plugin: JackClawPlugin;
    api: PluginAPI;
    subscriptionIds: string[];
    loadedAt: number;
    store: Map<string, unknown>;
    enabled: boolean;
}
export declare class PluginManager {
    private plugins;
    private config;
    /**
     * Register and initialize a plugin.
     */
    load(plugin: JackClawPlugin): Promise<void>;
    /**
     * Unload a plugin and remove all its subscriptions.
     */
    unload(name: string): Promise<void>;
    /**
     * List all loaded plugins.
     */
    list(): PluginManifest[];
    /**
     * Get a specific plugin instance.
     */
    get(name: string): PluginInstance | undefined;
    /**
     * Set plugin configuration.
     */
    setConfig(pluginName: string, config: Record<string, unknown>): void;
    /**
     * Get stats.
     */
    getStats(): {
        totalPlugins: number;
        pluginNames: string[];
        totalSubscriptions: number;
    };
}
/** Singleton PluginManager */
export declare const pluginManager: PluginManager;
export {};
//# sourceMappingURL=plugin-manager.d.ts.map