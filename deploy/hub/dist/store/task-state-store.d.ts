export interface TaskRecord {
    id: string;
    tenantId: string;
    title: string;
    description?: string;
    state: 'new' | 'assigned' | 'running' | 'blocked' | 'completed' | 'failed';
    assigneeId?: string;
    creatorId: string;
    priority?: 'low' | 'medium' | 'high' | 'urgent';
    metadata?: Record<string, unknown>;
    stateHistory: Array<{
        from: string;
        to: string;
        event: string;
        ts: number;
        actorId?: string;
    }>;
    createdAt: number;
    updatedAt: number;
}
/**
 * 任务状态存储。
 * Task state store with JSON-file persistence.
 */
export declare class TaskStateStore {
    /**
     * 加载全部任务，内部以 id 为 key。
     * Load all tasks keyed by id.
     */
    private load;
    /**
     * 持久化全部任务。
     * Persist all tasks to disk.
     */
    private save;
    /**
     * 创建任务。
     * Create a task record.
     */
    create(tenantId: string, title: string, creatorId: string, opts?: Partial<TaskRecord>): TaskRecord;
    /**
     * 按 id 获取任务。
     * Get one task by id.
     */
    get(id: string): TaskRecord | null;
    /**
     * 列出某个租户下的任务，可按状态/负责人过滤。
     * List tasks in one tenant with optional filters.
     */
    list(tenantId: string, opts?: {
        state?: string;
        assigneeId?: string;
        limit?: number;
    }): TaskRecord[];
    /**
     * 执行状态迁移。
     * Apply a state transition using TaskStateMachineConfig.
     */
    transition(id: string, event: string, actorId?: string): TaskRecord;
    /**
     * 分配负责人；如当前处于 new，会自动触发 assign 迁移到 assigned。
     * Assign a task; if task is new, auto-transition via assign event.
     */
    assign(id: string, assigneeId: string, actorId?: string): TaskRecord;
    /**
     * 更新任务可编辑字段。
     * Update editable task fields.
     */
    update(id: string, updates: Partial<Pick<TaskRecord, 'title' | 'description' | 'priority' | 'metadata'>>): TaskRecord;
    /**
     * 用状态机配置解析下一状态。
     * Resolve next state from the state-machine config.
     *
     * 说明：这里保留 StateMachine 实例以确保该 store 与统一状态机体系对齐；
     * 同时直接读取配置做同步解析，避免把 store API 变成 Promise 版本。
     * Keep a StateMachine instance for alignment with the shared state-machine system,
     * while resolving synchronously from config so this store can keep a sync API.
     */
    private resolveNextState;
}
export declare const taskStateStore: TaskStateStore;
//# sourceMappingURL=task-state-store.d.ts.map