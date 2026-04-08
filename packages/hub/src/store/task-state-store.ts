// JackClaw Hub - Task State Store
// Persists to ~/.jackclaw/hub/tasks-state.json

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import {
  StateMachine,
  TaskStateMachine as TaskStateMachineConfig,
  type TaskEvent,
  type TaskState,
} from '../state-machine'

// 存储目录 / Storage directory
const HUB_DIR = path.join(process.env.HOME ?? '~', '.jackclaw', 'hub')
const TASKS_STATE_FILE = path.join(HUB_DIR, 'tasks-state.json')

export interface TaskRecord {
  id: string
  tenantId: string
  title: string
  description?: string
  state: 'new' | 'assigned' | 'running' | 'blocked' | 'completed' | 'failed'
  assigneeId?: string
  creatorId: string
  priority?: 'low' | 'medium' | 'high' | 'urgent'
  metadata?: Record<string, unknown>
  stateHistory: Array<{ from: string; to: string; event: string; ts: number; actorId?: string }>
  createdAt: number
  updatedAt: number
}

interface TaskStateStoreShape {
  tasks: Record<string, TaskRecord>
}

/**
 * 读取 JSON 文件；不存在或损坏时返回兜底值。
 * Read JSON file; return fallback when file is missing or invalid.
 */
function loadJSON<T>(file: string, fallback: T): T {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8')) as T
  } catch {
    // ignore parse/read errors / 忽略读取或解析错误
  }
  return fallback
}

/**
 * 保存 JSON 文件，并自动创建父目录。
 * Save JSON file and auto-create parent directory.
 */
function saveJSON(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
}

/**
 * 任务状态存储。
 * Task state store with JSON-file persistence.
 */
export class TaskStateStore {
  /**
   * 加载全部任务，内部以 id 为 key。
   * Load all tasks keyed by id.
   */
  private load(): Record<string, TaskRecord> {
    const data = loadJSON<TaskStateStoreShape | Record<string, TaskRecord>>(TASKS_STATE_FILE, { tasks: {} })

    if (
      typeof data === 'object' &&
      data !== null &&
      'tasks' in data &&
      typeof data.tasks === 'object' &&
      data.tasks !== null
    ) {
      return data.tasks as Record<string, TaskRecord>
    }

    return data as Record<string, TaskRecord>
  }

  /**
   * 持久化全部任务。
   * Persist all tasks to disk.
   */
  private save(tasks: Record<string, TaskRecord>): void {
    saveJSON(TASKS_STATE_FILE, { tasks })
  }

  /**
   * 创建任务。
   * Create a task record.
   */
  create(tenantId: string, title: string, creatorId: string, opts: Partial<TaskRecord> = {}): TaskRecord {
    const tasks = this.load()
    const now = Date.now()

    const task: TaskRecord = {
      id: opts.id ?? crypto.randomUUID(),
      tenantId,
      title: (opts.title ?? title).trim(),
      description: opts.description,
      state: opts.state ?? 'new',
      assigneeId: opts.assigneeId,
      creatorId,
      priority: opts.priority,
      metadata: opts.metadata,
      stateHistory: opts.stateHistory ?? [],
      createdAt: opts.createdAt ?? now,
      updatedAt: opts.updatedAt ?? now,
    }

    tasks[task.id] = task
    this.save(tasks)
    return task
  }

  /**
   * 按 id 获取任务。
   * Get one task by id.
   */
  get(id: string): TaskRecord | null {
    return this.load()[id] ?? null
  }

  /**
   * 列出某个租户下的任务，可按状态/负责人过滤。
   * List tasks in one tenant with optional filters.
   */
  list(tenantId: string, opts: { state?: string; assigneeId?: string; limit?: number } = {}): TaskRecord[] {
    const { state, assigneeId, limit } = opts

    const items = Object.values(this.load())
      .filter(task => task.tenantId === tenantId)
      .filter(task => (state ? task.state === state : true))
      .filter(task => (assigneeId ? task.assigneeId === assigneeId : true))
      .sort((a, b) => b.updatedAt - a.updatedAt)

    return limit !== undefined ? items.slice(0, limit) : items
  }

  /**
   * 执行状态迁移。
   * Apply a state transition using TaskStateMachineConfig.
   */
  transition(id: string, event: string, actorId?: string): TaskRecord {
    const tasks = this.load()
    const task = tasks[id]
    if (!task) throw new Error(`Task not found: ${id}`)

    const nextState = this.resolveNextState(task.state, event as TaskEvent, task)
    const now = Date.now()

    task.stateHistory.push({
      from: task.state,
      to: nextState,
      event,
      ts: now,
      actorId,
    })

    task.state = nextState
    task.updatedAt = now

    tasks[id] = task
    this.save(tasks)
    return task
  }

  /**
   * 分配负责人；如当前处于 new，会自动触发 assign 迁移到 assigned。
   * Assign a task; if task is new, auto-transition via assign event.
   */
  assign(id: string, assigneeId: string, actorId?: string): TaskRecord {
    const tasks = this.load()
    const task = tasks[id]
    if (!task) throw new Error(`Task not found: ${id}`)

    task.assigneeId = assigneeId
    task.updatedAt = Date.now()
    tasks[id] = task
    this.save(tasks)

    return task.state === 'new' ? this.transition(id, 'assign', actorId) : task
  }

  /**
   * 更新任务可编辑字段。
   * Update editable task fields.
   */
  update(
    id: string,
    updates: Partial<Pick<TaskRecord, 'title' | 'description' | 'priority' | 'metadata'>>,
  ): TaskRecord {
    const tasks = this.load()
    const task = tasks[id]
    if (!task) throw new Error(`Task not found: ${id}`)

    if (updates.title !== undefined) task.title = updates.title.trim()
    if (updates.description !== undefined) task.description = updates.description
    if (updates.priority !== undefined) task.priority = updates.priority
    if (updates.metadata !== undefined) task.metadata = updates.metadata
    task.updatedAt = Date.now()

    tasks[id] = task
    this.save(tasks)
    return task
  }

  /**
   * 用状态机配置解析下一状态。
   * Resolve next state from the state-machine config.
   *
   * 说明：这里保留 StateMachine 实例以确保该 store 与统一状态机体系对齐；
   * 同时直接读取配置做同步解析，避免把 store API 变成 Promise 版本。
   * Keep a StateMachine instance for alignment with the shared state-machine system,
   * while resolving synchronously from config so this store can keep a sync API.
   */
  private resolveNextState(currentState: TaskState, event: TaskEvent, context: TaskRecord): TaskState {
    const machine = new StateMachine(TaskStateMachineConfig, context)
    void machine

    const transition = TaskStateMachineConfig.transitions.find((item) => {
      const fromStates = Array.isArray(item.from) ? item.from : [item.from]
      const matchesState = fromStates.includes(currentState)
      const matchesEvent = item.event === event
      const passesGuard = item.guard ? item.guard(context) : true
      return matchesState && matchesEvent && passesGuard
    })

    if (!transition) {
      throw new Error(`Invalid task transition: ${currentState} --${event}--> ?`)
    }

    return transition.to
  }
}

// 单例导出 / Singleton export
export const taskStateStore = new TaskStateStore()
