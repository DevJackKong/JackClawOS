"use strict";
// JackClaw Hub - Generic State Machine
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroupSessionStateMachine = exports.WorkflowStateMachine = exports.ApprovalStateMachine = exports.ConversationStateMachine = exports.TaskStateMachine = exports.StateMachine = void 0;
/**
 * 通用有限状态机 / Generic finite state machine
 */
class StateMachine {
    config;
    defaultContext;
    currentState;
    transitionHistory = [];
    constructor(config, context) {
        this.config = config;
        this.defaultContext = context;
        this.currentState = config.initial;
    }
    /** 当前状态 / Current state */
    get state() {
        return this.currentState;
    }
    /**
     * 返回历史副本，避免外部直接篡改
     * Return a copy of history to avoid external mutation
     */
    get history() {
        return [...this.transitionHistory];
    }
    /**
     * 判断某事件当前是否可触发
     * Check whether an event can be triggered from current state
     */
    can(event) {
        const transition = this.findTransition(this.currentState, event, this.defaultContext);
        return Boolean(transition);
    }
    /**
     * 执行一次状态迁移
     * Perform a state transition
     */
    async transition(event, context) {
        const ctx = context ?? this.defaultContext;
        const from = this.currentState;
        const transition = this.findTransition(from, event, ctx);
        if (!transition) {
            throw new Error(`Invalid transition: ${String(from)} --${String(event)}--> ?`);
        }
        await this.config.onExit?.[from]?.(ctx);
        await transition.action?.(ctx);
        this.currentState = transition.to;
        this.transitionHistory.push({
            from,
            event,
            to: transition.to,
            ts: Date.now(),
        });
        await this.config.onEnter?.[transition.to]?.(ctx);
        return this.currentState;
    }
    /**
     * 重置到初始状态，并清空历史
     * Reset to initial state and clear history
     */
    reset() {
        this.currentState = this.config.initial;
        this.transitionHistory = [];
    }
    /**
     * 查找符合条件的迁移规则
     * Find a matching transition rule
     */
    findTransition(state, event, ctx) {
        return this.config.transitions.find((transition) => {
            const fromStates = Array.isArray(transition.from) ? transition.from : [transition.from];
            const matchesState = fromStates.includes(state);
            const matchesEvent = transition.event === event;
            const passesGuard = transition.guard ? transition.guard(ctx) : true;
            return matchesState && matchesEvent && passesGuard;
        });
    }
}
exports.StateMachine = StateMachine;
/**
 * 任务状态机 / Task state machine
 * new → assigned → running → blocked → completed → failed
 */
exports.TaskStateMachine = {
    initial: 'new',
    transitions: [
        { from: 'new', event: 'assign', to: 'assigned' },
        { from: 'assigned', event: 'start', to: 'running' },
        { from: 'running', event: 'block', to: 'blocked' },
        { from: 'blocked', event: 'resume', to: 'running' },
        { from: 'running', event: 'complete', to: 'completed' },
        { from: ['new', 'assigned', 'running', 'blocked'], event: 'fail', to: 'failed' },
        { from: 'failed', event: 'retry', to: 'assigned' },
    ],
};
/**
 * 会话状态机 / Conversation state machine
 * new → active → waiting → escalated → closed
 */
exports.ConversationStateMachine = {
    initial: 'new',
    transitions: [
        { from: 'new', event: 'activate', to: 'active' },
        { from: 'active', event: 'wait', to: 'waiting' },
        { from: 'waiting', event: 'resume', to: 'active' },
        { from: ['active', 'waiting'], event: 'escalate', to: 'escalated' },
        { from: ['active', 'waiting', 'escalated'], event: 'close', to: 'closed' },
        { from: 'closed', event: 'reopen', to: 'active' },
    ],
};
/**
 * 审批状态机 / Approval state machine
 * pending → approved / rejected / expired
 */
exports.ApprovalStateMachine = {
    initial: 'pending',
    transitions: [
        { from: 'pending', event: 'approve', to: 'approved' },
        { from: 'pending', event: 'reject', to: 'rejected' },
        { from: 'pending', event: 'expire', to: 'expired' },
    ],
};
/**
 * 工作流状态机 / Workflow state machine
 * draft → running → paused → completed → cancelled
 */
exports.WorkflowStateMachine = {
    initial: 'draft',
    transitions: [
        { from: 'draft', event: 'start', to: 'running' },
        { from: 'running', event: 'pause', to: 'paused' },
        { from: 'paused', event: 'resume', to: 'running' },
        { from: ['running', 'paused'], event: 'complete', to: 'completed' },
        { from: ['draft', 'running', 'paused'], event: 'cancel', to: 'cancelled' },
    ],
};
/**
 * 群组会话状态机 / Group session state machine
 * created → active → idle → archived
 */
exports.GroupSessionStateMachine = {
    initial: 'created',
    transitions: [
        { from: 'created', event: 'activate', to: 'active' },
        { from: 'active', event: 'idle', to: 'idle' },
        { from: 'idle', event: 'resume', to: 'active' },
        { from: ['created', 'active', 'idle'], event: 'archive', to: 'archived' },
    ],
};
//# sourceMappingURL=state-machine.js.map