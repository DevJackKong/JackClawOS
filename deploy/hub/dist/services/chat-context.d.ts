/**
 * Chat Context Service / 聊天上下文聚合服务
 *
 * Aggregate lightweight contact/task/memory/approval context for one node.
 * 为单个 node 聚合轻量级联系人、任务、记忆、审批上下文。
 *
 * Design goals / 设计目标：
 * - Best-effort aggregation: missing store methods should not break callers
 *   尽力聚合：某个 store 缺方法时，不影响整体返回
 * - Small and safe payloads for chat-side context injection
 *   返回体保持轻量，适合注入聊天上下文
 * - Heuristic fallbacks where canonical store APIs are not available
 *   当缺少标准 API 时，使用启发式降级
 */
export interface ChatContext {
    contact?: {
        nodeId: string;
        handle?: string;
        displayName?: string;
        role?: string;
        lastSeen?: number;
    };
    recentTasks?: Array<{
        id: string;
        title: string;
        state: string;
        assignee?: string;
        updatedAt: number;
    }>;
    recentMemory?: Array<{
        key: string;
        value: string;
        updatedAt: number;
    }>;
    pendingApprovals?: Array<{
        id: string;
        type: string;
        requestedBy: string;
        requestedAt: number;
    }>;
    recommendedActions?: string[];
    riskAlerts?: string[];
}
export declare class ChatContextService {
    private readonly orgMemoryStore;
    /**
     * Build chat context for a node / 为指定 node 构建聊天上下文。
     */
    getContext(nodeId: string, tenantId?: string): Promise<ChatContext>;
    /**
     * Resolve contact info from directory + nodes + users + members.
     * 从目录、节点、用户、成员表综合联系人信息。
     */
    private getContact;
    /**
     * Derive recent tasks from participant messages.
     * 当前仓库没有统一 task store 导出时，从消息存储做启发式推断。
     */
    private getRecentTasks;
    /**
     * Aggregate recent memory from shared memdirs + org memory store.
     * 从共享 MemDir 与组织记忆中聚合最近记忆。
     */
    private getRecentMemory;
    /**
     * Derive pending approvals from approval messages or pending-review executions.
     * 从 approval 消息或 pending-review 执行状态中推断待审批项。
     */
    private getPendingApprovals;
    /**
     * Generate lightweight alerts / 生成轻量风险提醒。
     */
    private buildRiskAlerts;
    /**
     * Generate suggested next actions / 生成建议动作。
     */
    private buildRecommendedActions;
    /** Best-effort call wrapper / 尽力调用包装器。 */
    private safeCall;
    /** Truncate content into a task-like title / 将内容截断为任务标题。 */
    private toTaskTitle;
    /** Map message shape to a coarse task state / 将消息状态映射为粗粒度任务状态。 */
    private toTaskState;
    /** Infer assignee from message direction / 通过消息方向推断负责人。 */
    private inferAssignee;
    private pickString;
    private pickNumber;
}
export declare const chatContextService: ChatContextService;
//# sourceMappingURL=chat-context.d.ts.map