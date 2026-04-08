export interface TraceEntry {
    id: string;
    tenantId: string;
    type: 'message' | 'task' | 'approval' | 'memory' | 'delegation' | 'system';
    action: string;
    actorId: string;
    targetId?: string;
    parentTraceId?: string;
    metadata?: Record<string, unknown>;
    timestamp: number;
}
export interface TraceSearchQuery {
    tenantId?: string;
    type?: string;
    action?: string;
    from?: number;
    to?: number;
}
export declare class TraceStore {
    private readonly file;
    private traces;
    private byId;
    constructor(file?: string);
    /**
     * Add one trace entry and persist it as append-only JSONL.
     * 添加追踪记录，并以 append-only JSONL 方式持久化。
     */
    add(entry: Omit<TraceEntry, 'id' | 'timestamp'>): TraceEntry;
    /**
     * Get one trace by id.
     * 按 id 获取单条追踪记录。
     */
    get(id: string): TraceEntry | null;
    /**
     * List traces under one tenant.
     * 按租户列出追踪记录。
     */
    listByTenant(tenantId: string, limit?: number): TraceEntry[];
    /**
     * List traces created by one actor.
     * 按执行者列出追踪记录。
     */
    listByActor(actorId: string, limit?: number): TraceEntry[];
    /**
     * List traces pointing to one target entity.
     * 按目标实体列出追踪记录。
     */
    listByTarget(targetId: string, limit?: number): TraceEntry[];
    /**
     * Follow parentTraceId upward and return the full chain.
     * 沿 parentTraceId 向上追溯，返回完整链路。
     */
    getChain(traceId: string): TraceEntry[];
    /**
     * Search traces by structured conditions.
     * 按结构化条件搜索追踪记录。
     */
    search(query: TraceSearchQuery, limit?: number): TraceEntry[];
}
export declare const traceStore: TraceStore;
//# sourceMappingURL=trace-store.d.ts.map