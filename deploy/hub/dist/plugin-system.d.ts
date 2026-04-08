/**
 * 插件清单 / Plugin manifest metadata.
 */
export interface PluginManifest {
    id: string;
    name: string;
    version: string;
    description?: string;
    author?: string;
    hooks: string[];
    permissions?: string[];
    config?: Record<string, unknown>;
}
/**
 * 插件实例状态 / Runtime plugin instance state.
 */
export interface PluginInstance {
    manifest: PluginManifest;
    status: 'loaded' | 'active' | 'disabled' | 'error';
    loadedAt: number;
    error?: string;
}
/**
 * 插件 Hook 处理器 / Plugin hook handler.
 */
export type PluginHookHandler = (event: {
    type: string;
    data: unknown;
    source?: string;
}) => void | Promise<void>;
/**
 * 插件定义 / Plugin contract.
 */
export interface Plugin {
    manifest: PluginManifest;
    onLoad?: () => void | Promise<void>;
    onUnload?: () => void | Promise<void>;
    hooks: Record<string, PluginHookHandler>;
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
export declare class PluginSystem {
    private readonly plugins;
    /**
     * 注册插件。
     * Register a plugin.
     */
    register(plugin: Plugin): PluginInstance;
    /**
     * 注销插件。
     * Unregister a plugin.
     */
    unregister(pluginId: string): boolean;
    /**
     * 启用插件。
     * Enable a plugin.
     */
    enable(pluginId: string): PluginInstance;
    /**
     * 禁用插件。
     * Disable a plugin.
     */
    disable(pluginId: string): PluginInstance;
    /**
     * 获取插件实例。
     * Get one plugin instance.
     */
    getPlugin(pluginId: string): PluginInstance | null;
    /**
     * 列出全部插件。
     * List all plugin instances.
     */
    listPlugins(): PluginInstance[];
    /**
     * 按 Hook 名称筛选插件。
     * List plugins by hook name.
     */
    listByHook(hookName: string): PluginInstance[];
    /**
     * 手动触发 Hook。
     * Invoke a hook across all active plugins.
     */
    invokeHook(hookName: string, event: {
        type: string;
        data: unknown;
        source?: string;
    }): Promise<void>;
    /**
     * 校验插件定义。
     * Validate plugin definition.
     */
    private validatePlugin;
    /**
     * 获取已注册插件，不存在则抛错。
     * Get a registered plugin or throw.
     */
    private requirePlugin;
    /**
     * 安全执行 onLoad。
     * Run onLoad safely without changing public sync APIs.
     */
    private runOnLoad;
    /**
     * 安全执行 onUnload。
     * Run onUnload safely without changing public sync APIs.
     */
    private runOnUnload;
}
/**
 * 插件系统单例。
 * Singleton plugin system instance.
 */
export declare const pluginSystem: PluginSystem;
//# sourceMappingURL=plugin-system.d.ts.map