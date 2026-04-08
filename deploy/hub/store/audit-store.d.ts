/**
 * API audit log entry.
 * API 审计日志记录结构。
 */
export interface ApiAuditLogEntry {
    id?: string;
    timestamp?: number;
    tenantId?: string;
    orgId?: string;
    userId?: string;
    method: string;
    path: string;
    statusCode: number;
    result: 'success' | 'rejected' | 'failure';
    ip?: string;
    userAgent?: string;
    durationMs?: number;
    action?: string;
    category?: string;
    actorId?: string;
    actorType?: string;
    [key: string]: unknown;
}
/**
 * Lightweight append-only audit store with query support.
 * 轻量级追加写入审计存储，支持查询。
 */
declare class AuditStore {
    private readonly filePath;
    constructor(filePath?: string);
    /**
     * Persist one audit entry as JSONL.
     * 以 JSONL 形式持久化一条审计记录。
     */
    log(entry: Partial<ApiAuditLogEntry>): ApiAuditLogEntry;
    /**
     * Load all entries from JSONL file.
     * 从 JSONL 文件加载所有记录。
     */
    private loadAll;
    /**
     * Get a single entry by id.
     * 按 ID 获取单条记录。
     */
    get(id: string): ApiAuditLogEntry | null;
    /**
     * Query entries with filters.
     * 按条件查询记录。
     */
    query(opts?: {
        tenantId?: string;
        category?: string;
        actorId?: string;
        action?: string;
        result?: string;
        from?: number;
        to?: number;
        limit?: number;
    }): ApiAuditLogEntry[];
    /**
     * Get stats for a tenant.
     * 获取租户审计统计。
     */
    stats(tenantId?: string, from?: number, to?: number): {
        total: number;
        byResult: Record<string, number>;
        byMethod: Record<string, number>;
    };
}
export declare const auditStore: AuditStore;
export default auditStore;
//# sourceMappingURL=audit-store.d.ts.map