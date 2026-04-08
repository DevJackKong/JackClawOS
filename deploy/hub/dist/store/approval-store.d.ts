type ApprovalState = 'pending' | 'approved' | 'rejected' | 'expired';
export interface ApprovalRecord {
    id: string;
    tenantId: string;
    type: string;
    title: string;
    description?: string;
    state: ApprovalState;
    requestedBy: string;
    approvedBy?: string;
    rejectedBy?: string;
    reason?: string;
    metadata?: Record<string, unknown>;
    stateHistory: Array<{
        from: string;
        to: string;
        event: string;
        ts: number;
        actorId?: string;
    }>;
    expiresAt?: number;
    createdAt: number;
    updatedAt: number;
}
export declare class ApprovalStore {
    private readonly file;
    private readonly machine;
    constructor(file?: string);
    /**
     * Load all approval records.
     * 加载全部审批记录。
     */
    private load;
    /**
     * Persist approval records.
     * 持久化审批记录。
     */
    private save;
    /**
     * Require one record by id.
     * 按 id 获取记录；不存在时抛错。
     */
    private mustGet;
    /**
     * Apply one state transition and append history.
     * 执行状态流转，并写入状态历史。
     */
    private transition;
    /**
     * Create a new approval request.
     * 创建一条新的审批请求。
     */
    create(tenantId: string, type: string, title: string, requestedBy: string, opts?: Partial<ApprovalRecord>): ApprovalRecord;
    /**
     * Get one approval record by id.
     * 按 id 获取审批记录。
     */
    get(id: string): ApprovalRecord | null;
    /**
     * List records under one tenant with optional filters.
     * 按租户列出审批记录，支持状态/申请人/数量过滤。
     */
    list(tenantId: string, opts?: {
        state?: string;
        requestedBy?: string;
        limit?: number;
    }): ApprovalRecord[];
    /**
     * Approve a pending record.
     * 批准一条待审批记录。
     */
    approve(id: string, approvedBy: string, reason?: string): ApprovalRecord;
    /**
     * Reject a pending record.
     * 拒绝一条待审批记录。
     */
    reject(id: string, rejectedBy: string, reason?: string): ApprovalRecord;
    /**
     * Expire a pending record.
     * 将一条待审批记录标记为已过期。
     */
    expire(id: string): ApprovalRecord;
    /**
     * List pending approvals for one tenant.
     * 列出租户下所有待审批记录。
     */
    pending(tenantId: string): ApprovalRecord[];
}
export declare const approvalStore: ApprovalStore;
export {};
//# sourceMappingURL=approval-store.d.ts.map