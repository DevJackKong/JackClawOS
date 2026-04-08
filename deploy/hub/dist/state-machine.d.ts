/**
 * 通用状态迁移定义 / Generic transition definition
 */
export interface StateMachineTransition<S extends string, E extends string> {
    /** 当前状态或多个允许的来源状态 / Current state or allowed source states */
    from: S | S[];
    /** 触发事件 / Trigger event */
    event: E;
    /** 目标状态 / Target state */
    to: S;
    /**
     * 守卫条件：返回 true 才允许迁移
     * Guard: transition is allowed only when it returns true
     */
    guard?: (ctx: unknown) => boolean;
    /**
     * 迁移动作：在状态切换前执行
     * Action executed before the state is updated
     */
    action?: (ctx: unknown) => void | Promise<void>;
}
/**
 * 状态机配置 / State machine configuration
 */
export interface StateMachineConfig<S extends string, E extends string> {
    /** 初始状态 / Initial state */
    initial: S;
    /** 所有允许的迁移规则 / Allowed transitions */
    transitions: Array<StateMachineTransition<S, E>>;
    /** 进入某状态时触发 / Called when entering a state */
    onEnter?: Partial<Record<S, (ctx: unknown) => void | Promise<void>>>;
    /** 离开某状态时触发 / Called when leaving a state */
    onExit?: Partial<Record<S, (ctx: unknown) => void | Promise<void>>>;
}
/**
 * 状态迁移历史 / Transition history item
 */
export interface StateMachineHistory<S extends string, E extends string> {
    from: S;
    event: E;
    to: S;
    ts: number;
}
/**
 * 通用有限状态机 / Generic finite state machine
 */
export declare class StateMachine<S extends string, E extends string> {
    private readonly config;
    private readonly defaultContext;
    private currentState;
    private transitionHistory;
    constructor(config: StateMachineConfig<S, E>, context?: unknown);
    /** 当前状态 / Current state */
    get state(): S;
    /**
     * 返回历史副本，避免外部直接篡改
     * Return a copy of history to avoid external mutation
     */
    get history(): Array<StateMachineHistory<S, E>>;
    /**
     * 判断某事件当前是否可触发
     * Check whether an event can be triggered from current state
     */
    can(event: E): boolean;
    /**
     * 执行一次状态迁移
     * Perform a state transition
     */
    transition(event: E, context?: unknown): Promise<S>;
    /**
     * 重置到初始状态，并清空历史
     * Reset to initial state and clear history
     */
    reset(): void;
    /**
     * 查找符合条件的迁移规则
     * Find a matching transition rule
     */
    private findTransition;
}
export type TaskState = 'new' | 'assigned' | 'running' | 'blocked' | 'completed' | 'failed';
export type TaskEvent = 'assign' | 'start' | 'block' | 'resume' | 'complete' | 'fail' | 'retry';
/**
 * 任务状态机 / Task state machine
 * new → assigned → running → blocked → completed → failed
 */
export declare const TaskStateMachine: StateMachineConfig<TaskState, TaskEvent>;
export type ConversationState = 'new' | 'active' | 'waiting' | 'escalated' | 'closed';
export type ConversationEvent = 'activate' | 'wait' | 'resume' | 'escalate' | 'close' | 'reopen';
/**
 * 会话状态机 / Conversation state machine
 * new → active → waiting → escalated → closed
 */
export declare const ConversationStateMachine: StateMachineConfig<ConversationState, ConversationEvent>;
export type ApprovalState = 'pending' | 'approved' | 'rejected' | 'expired';
export type ApprovalEvent = 'approve' | 'reject' | 'expire';
/**
 * 审批状态机 / Approval state machine
 * pending → approved / rejected / expired
 */
export declare const ApprovalStateMachine: StateMachineConfig<ApprovalState, ApprovalEvent>;
export type WorkflowState = 'draft' | 'running' | 'paused' | 'completed' | 'cancelled';
export type WorkflowEvent = 'start' | 'pause' | 'resume' | 'complete' | 'cancel';
/**
 * 工作流状态机 / Workflow state machine
 * draft → running → paused → completed → cancelled
 */
export declare const WorkflowStateMachine: StateMachineConfig<WorkflowState, WorkflowEvent>;
export type GroupSessionState = 'created' | 'active' | 'idle' | 'archived';
export type GroupSessionEvent = 'activate' | 'idle' | 'resume' | 'archive';
/**
 * 群组会话状态机 / Group session state machine
 * created → active → idle → archived
 */
export declare const GroupSessionStateMachine: StateMachineConfig<GroupSessionState, GroupSessionEvent>;
//# sourceMappingURL=state-machine.d.ts.map