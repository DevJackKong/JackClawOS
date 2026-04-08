// JackClaw Hub - Generic State Machine

/**
 * 通用状态迁移定义 / Generic transition definition
 */
export interface StateMachineTransition<S extends string, E extends string> {
  /** 当前状态或多个允许的来源状态 / Current state or allowed source states */
  from: S | S[]
  /** 触发事件 / Trigger event */
  event: E
  /** 目标状态 / Target state */
  to: S
  /**
   * 守卫条件：返回 true 才允许迁移
   * Guard: transition is allowed only when it returns true
   */
  guard?: (ctx: unknown) => boolean
  /**
   * 迁移动作：在状态切换前执行
   * Action executed before the state is updated
   */
  action?: (ctx: unknown) => void | Promise<void>
}

/**
 * 状态机配置 / State machine configuration
 */
export interface StateMachineConfig<S extends string, E extends string> {
  /** 初始状态 / Initial state */
  initial: S
  /** 所有允许的迁移规则 / Allowed transitions */
  transitions: Array<StateMachineTransition<S, E>>
  /** 进入某状态时触发 / Called when entering a state */
  onEnter?: Partial<Record<S, (ctx: unknown) => void | Promise<void>>>
  /** 离开某状态时触发 / Called when leaving a state */
  onExit?: Partial<Record<S, (ctx: unknown) => void | Promise<void>>>
}

/**
 * 状态迁移历史 / Transition history item
 */
export interface StateMachineHistory<S extends string, E extends string> {
  from: S
  event: E
  to: S
  ts: number
}

/**
 * 通用有限状态机 / Generic finite state machine
 */
export class StateMachine<S extends string, E extends string> {
  private readonly config: StateMachineConfig<S, E>
  private readonly defaultContext: unknown
  private currentState: S
  private transitionHistory: Array<StateMachineHistory<S, E>> = []

  constructor(config: StateMachineConfig<S, E>, context?: unknown) {
    this.config = config
    this.defaultContext = context
    this.currentState = config.initial
  }

  /** 当前状态 / Current state */
  get state(): S {
    return this.currentState
  }

  /**
   * 返回历史副本，避免外部直接篡改
   * Return a copy of history to avoid external mutation
   */
  get history(): Array<StateMachineHistory<S, E>> {
    return [...this.transitionHistory]
  }

  /**
   * 判断某事件当前是否可触发
   * Check whether an event can be triggered from current state
   */
  can(event: E): boolean {
    const transition = this.findTransition(this.currentState, event, this.defaultContext)
    return Boolean(transition)
  }

  /**
   * 执行一次状态迁移
   * Perform a state transition
   */
  async transition(event: E, context?: unknown): Promise<S> {
    const ctx = context ?? this.defaultContext
    const from = this.currentState
    const transition = this.findTransition(from, event, ctx)

    if (!transition) {
      throw new Error(`Invalid transition: ${String(from)} --${String(event)}--> ?`)
    }

    await this.config.onExit?.[from]?.(ctx)
    await transition.action?.(ctx)

    this.currentState = transition.to

    this.transitionHistory.push({
      from,
      event,
      to: transition.to,
      ts: Date.now(),
    })

    await this.config.onEnter?.[transition.to]?.(ctx)

    return this.currentState
  }

  /**
   * 重置到初始状态，并清空历史
   * Reset to initial state and clear history
   */
  reset(): void {
    this.currentState = this.config.initial
    this.transitionHistory = []
  }

  /**
   * 查找符合条件的迁移规则
   * Find a matching transition rule
   */
  private findTransition(state: S, event: E, ctx: unknown): StateMachineTransition<S, E> | undefined {
    return this.config.transitions.find((transition) => {
      const fromStates = Array.isArray(transition.from) ? transition.from : [transition.from]
      const matchesState = fromStates.includes(state)
      const matchesEvent = transition.event === event
      const passesGuard = transition.guard ? transition.guard(ctx) : true

      return matchesState && matchesEvent && passesGuard
    })
  }
}

// -----------------------------------------------------------------------------
// 业务状态机配置 / Business state machine presets
// -----------------------------------------------------------------------------

export type TaskState = 'new' | 'assigned' | 'running' | 'blocked' | 'completed' | 'failed'
export type TaskEvent =
  | 'assign'
  | 'start'
  | 'block'
  | 'resume'
  | 'complete'
  | 'fail'
  | 'retry'

/**
 * 任务状态机 / Task state machine
 * new → assigned → running → blocked → completed → failed
 */
export const TaskStateMachine: StateMachineConfig<TaskState, TaskEvent> = {
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
}

export type ConversationState = 'new' | 'active' | 'waiting' | 'escalated' | 'closed'
export type ConversationEvent = 'activate' | 'wait' | 'resume' | 'escalate' | 'close' | 'reopen'

/**
 * 会话状态机 / Conversation state machine
 * new → active → waiting → escalated → closed
 */
export const ConversationStateMachine: StateMachineConfig<ConversationState, ConversationEvent> = {
  initial: 'new',
  transitions: [
    { from: 'new', event: 'activate', to: 'active' },
    { from: 'active', event: 'wait', to: 'waiting' },
    { from: 'waiting', event: 'resume', to: 'active' },
    { from: ['active', 'waiting'], event: 'escalate', to: 'escalated' },
    { from: ['active', 'waiting', 'escalated'], event: 'close', to: 'closed' },
    { from: 'closed', event: 'reopen', to: 'active' },
  ],
}

export type ApprovalState = 'pending' | 'approved' | 'rejected' | 'expired'
export type ApprovalEvent = 'approve' | 'reject' | 'expire'

/**
 * 审批状态机 / Approval state machine
 * pending → approved / rejected / expired
 */
export const ApprovalStateMachine: StateMachineConfig<ApprovalState, ApprovalEvent> = {
  initial: 'pending',
  transitions: [
    { from: 'pending', event: 'approve', to: 'approved' },
    { from: 'pending', event: 'reject', to: 'rejected' },
    { from: 'pending', event: 'expire', to: 'expired' },
  ],
}

export type WorkflowState = 'draft' | 'running' | 'paused' | 'completed' | 'cancelled'
export type WorkflowEvent = 'start' | 'pause' | 'resume' | 'complete' | 'cancel'

/**
 * 工作流状态机 / Workflow state machine
 * draft → running → paused → completed → cancelled
 */
export const WorkflowStateMachine: StateMachineConfig<WorkflowState, WorkflowEvent> = {
  initial: 'draft',
  transitions: [
    { from: 'draft', event: 'start', to: 'running' },
    { from: 'running', event: 'pause', to: 'paused' },
    { from: 'paused', event: 'resume', to: 'running' },
    { from: ['running', 'paused'], event: 'complete', to: 'completed' },
    { from: ['draft', 'running', 'paused'], event: 'cancel', to: 'cancelled' },
  ],
}

export type GroupSessionState = 'created' | 'active' | 'idle' | 'archived'
export type GroupSessionEvent = 'activate' | 'idle' | 'resume' | 'archive'

/**
 * 群组会话状态机 / Group session state machine
 * created → active → idle → archived
 */
export const GroupSessionStateMachine: StateMachineConfig<GroupSessionState, GroupSessionEvent> = {
  initial: 'created',
  transitions: [
    { from: 'created', event: 'activate', to: 'active' },
    { from: 'active', event: 'idle', to: 'idle' },
    { from: 'idle', event: 'resume', to: 'active' },
    { from: ['created', 'active', 'idle'], event: 'archive', to: 'archived' },
  ],
}
