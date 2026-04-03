// JackClaw Protocol - TaskBundle 强/弱束协议
// 核心理念（Messy Jobs 第3章）：任务不应单独下发。
// 多数工作是"强束"：拆开就丢失价值（共享上下文、责任归属、协同机制）。

import { randomUUID } from 'crypto'

export type BundleStrength = 'weak' | 'strong'

export interface TaskDependency {
  taskId: string
  type: 'sequential' | 'context_share' | 'responsibility'
  // sequential:      必须按顺序执行
  // context_share:   共享上下文信息（拆分后会丢失）
  // responsibility:  责任归属不可分割
}

export interface TaskBundle {
  bundleId: string
  strength: BundleStrength
  tasks: BundledTask[]
  dependencies: TaskDependency[]
  sharedContext?: string         // 强束共享的上下文
  responsibleNodeId: string      // 整个束的责任归属节点
  canParallelize: boolean        // 弱束可并行，强束串行
  humanApprovalRequired: boolean // 是否需要真人审批
  autonomyLevel: 0 | 1 | 2 | 3  // 对应 L0-L3 自主度
  createdAt: number
}

export interface BundledTask {
  taskId: string
  action: string
  params: Record<string, unknown>
  dependsOn?: string[]  // 依赖哪些 taskId
  deadline?: number
  verifiable: boolean   // 输出是否可被外部验证
}

/**
 * 判断一组任务是否形成强束。
 *
 * 强束判定规则：
 * 1. 存在 context_share 或 responsibility 类型的依赖 → 强束
 * 2. 所有任务共享同一上下文字符串 → 强束
 * 3. 存在循环依赖（任务互相依赖） → 强束
 * 4. 纯 sequential 依赖链 → 弱束（可拆分串行执行）
 * 5. 无依赖 → 弱束
 */
export function analyzeBundleStrength(tasks: BundledTask[], context: string): BundleStrength {
  if (!tasks || tasks.length === 0) return 'weak'

  // 规则 1：有 context_share 或 responsibility 依赖 → 强束
  const taskIdSet = new Set(tasks.map(t => t.taskId))
  for (const task of tasks) {
    if (!task.dependsOn) continue
    // 如果任意任务依赖于束外任务，暂不影响判断
    // 这里只分析束内依赖
    for (const dep of task.dependsOn) {
      if (!taskIdSet.has(dep)) continue
      // 注意：dependsOn 只有 taskId，没有 type；
      // type 信息来自 TaskDependency，不在 BundledTask 上。
      // 这里通过 context 内容推断：如果 context 非空，说明有共享上下文。
    }
  }

  // 规则 2：context 非空且多于一个任务 → 强束（共享上下文不可拆）
  if (context && context.trim().length > 0 && tasks.length > 1) {
    return 'strong'
  }

  // 规则 3：检测循环依赖 → 强束
  if (hasCyclicDependency(tasks)) {
    return 'strong'
  }

  // 规则 4/5：纯 sequential 或无依赖 → 弱束
  return 'weak'
}

/** 拓扑排序检测循环依赖 */
function hasCyclicDependency(tasks: BundledTask[]): boolean {
  const graph = new Map<string, string[]>()
  for (const task of tasks) {
    graph.set(task.taskId, task.dependsOn?.filter(d => graph.has(d) || tasks.some(t => t.taskId === d)) ?? [])
  }

  const visited = new Set<string>()
  const inStack = new Set<string>()

  function dfs(id: string): boolean {
    if (inStack.has(id)) return true
    if (visited.has(id)) return false
    visited.add(id)
    inStack.add(id)
    for (const dep of graph.get(id) ?? []) {
      if (dfs(dep)) return true
    }
    inStack.delete(id)
    return false
  }

  for (const task of tasks) {
    if (dfs(task.taskId)) return true
  }
  return false
}

/**
 * 创建任务束。
 * opts 中的字段会覆盖自动推断的默认值。
 */
export function createBundle(tasks: BundledTask[], opts: Partial<TaskBundle> = {}): TaskBundle {
  const context = opts.sharedContext ?? ''
  const strength = opts.strength ?? analyzeBundleStrength(tasks, context)
  const isStrong = strength === 'strong'

  const bundle: TaskBundle = {
    bundleId: opts.bundleId ?? randomUUID(),
    strength,
    tasks,
    dependencies: opts.dependencies ?? [],
    sharedContext: opts.sharedContext,
    responsibleNodeId: opts.responsibleNodeId ?? 'unassigned',
    canParallelize: opts.canParallelize !== undefined ? opts.canParallelize : !isStrong,
    humanApprovalRequired: opts.humanApprovalRequired !== undefined
      ? opts.humanApprovalRequired
      : isStrong,                    // 强束默认需要审批
    autonomyLevel: opts.autonomyLevel ?? (isStrong ? 1 : 2),
    createdAt: opts.createdAt ?? Date.now(),
  }

  return bundle
}

/**
 * 拆分弱束（可并行执行）。
 *
 * 返回二维数组：每个子数组代表一个并行执行层（同层内任务可同时跑）。
 * 按拓扑排序分层：无依赖 → 第0层，依赖第0层 → 第1层，以此类推。
 *
 * 注意：强束不可拆分，调用此函数会抛出错误。
 */
export function splitWeakBundle(bundle: TaskBundle): BundledTask[][] {
  if (bundle.strength === 'strong') {
    throw new Error(`Bundle ${bundle.bundleId} is a strong bundle and cannot be split.`)
  }

  const tasks = bundle.tasks
  if (tasks.length === 0) return []

  // 拓扑排序分层
  const inDegree = new Map<string, number>()
  const taskMap = new Map<string, BundledTask>()

  for (const task of tasks) {
    taskMap.set(task.taskId, task)
    inDegree.set(task.taskId, 0)
  }

  // 只计算束内依赖
  const taskIdSet = new Set(tasks.map(t => t.taskId))
  for (const task of tasks) {
    for (const dep of task.dependsOn ?? []) {
      if (taskIdSet.has(dep)) {
        inDegree.set(task.taskId, (inDegree.get(task.taskId) ?? 0) + 1)
      }
    }
  }

  const layers: BundledTask[][] = []
  let remaining = new Set(tasks.map(t => t.taskId))

  while (remaining.size > 0) {
    // 找出当前入度为 0 的任务（可并行执行）
    const layer: BundledTask[] = []
    for (const id of remaining) {
      if ((inDegree.get(id) ?? 0) === 0) {
        layer.push(taskMap.get(id)!)
      }
    }

    if (layer.length === 0) {
      // 存在循环依赖，不应发生（analyzeBundleStrength 应已检测）
      throw new Error(`Circular dependency detected in bundle ${bundle.bundleId}`)
    }

    layers.push(layer)

    // 从图中移除该层，更新入度
    for (const task of layer) {
      remaining.delete(task.taskId)
    }

    for (const id of remaining) {
      const task = taskMap.get(id)!
      const bundledDeps = (task.dependsOn ?? []).filter(d => taskIdSet.has(d))
      const resolvedDeps = bundledDeps.filter(d => !remaining.has(d))
      // 重新计算入度（未解决的束内依赖数）
      const unresolvedDeps = bundledDeps.filter(d => remaining.has(d))
      inDegree.set(id, unresolvedDeps.length)
    }
  }

  return layers
}
