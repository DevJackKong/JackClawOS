export interface ConfigEntry {
    key: string;
    value: unknown;
    scope: 'system' | 'tenant' | 'org' | 'user';
    scopeId?: string;
    description?: string;
    updatedBy?: string;
    updatedAt: number;
}
export declare class ConfigStore {
    private readonly file;
    constructor(file?: string);
    /**
     * Load all config entries from disk.
     * 从磁盘加载全部配置项。
     */
    private load;
    /**
     * Persist all config entries to disk.
     * 将全部配置项写回磁盘。
     */
    private save;
    /**
     * Find one exact config entry by key + scope + scopeId.
     * 按 key + scope + scopeId 精确查找配置项。
     */
    private findEntry;
    /**
     * Get one config value by exact scope.
     * 按精确作用域读取配置值。
     */
    get(key: string, scope?: string, scopeId?: string): unknown;
    /**
     * Create or update one config entry.
     * 创建或更新一条配置记录。
     */
    set(key: string, value: unknown, scope: string, scopeId?: string, updatedBy?: string): ConfigEntry;
    /**
     * Delete config entries by key and optional scope filter.
     * 按 key 删除配置；可选按 scope/scopeId 限定范围。
     */
    delete(key: string, scope?: string, scopeId?: string): boolean;
    /**
     * List config entries with optional scope filter.
     * 列出配置项；可按 scope/scopeId 过滤。
     */
    list(scope?: string, scopeId?: string): ConfigEntry[];
    /**
     * Resolve effective config value by inheritance priority.
     * 按继承优先级解析最终配置：user > org > tenant > system。
     */
    getEffective(key: string, tenantId?: string, orgId?: string, userId?: string): unknown;
}
export declare const configStore: ConfigStore;
//# sourceMappingURL=config-store.d.ts.map