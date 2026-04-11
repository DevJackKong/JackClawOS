export interface DagNode {
  id: string
  taskType: string
  payload: Record<string, unknown>
  dependsOn: string[]
  status: 'pending' | 'running' | 'done' | 'failed'
  result?: unknown
  error?: string
  startedAt?: number
  endedAt?: number
}

export interface DagExecution {
  dagId: string
  nodes: DagNode[]
  status: 'pending' | 'running' | 'done' | 'failed'
  createdAt: number
  completedAt?: number
}

export class TaskDag {
  private readonly execution: DagExecution
  private readonly nodeMap = new Map<string, DagNode>()

  constructor(dagId = `dag-${Date.now()}`) {
    this.execution = {
      dagId,
      nodes: [],
      status: 'pending',
      createdAt: Date.now(),
    }
  }

  addNode(node: Omit<DagNode, 'status'>): void {
    if (this.nodeMap.has(node.id)) {
      throw new Error(`Duplicate DAG node id: ${node.id}`)
    }

    const dagNode: DagNode = {
      ...node,
      dependsOn: [...node.dependsOn],
      status: 'pending',
    }

    this.execution.nodes.push(dagNode)
    this.nodeMap.set(dagNode.id, dagNode)
  }

  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    for (const node of this.execution.nodes) {
      for (const depId of node.dependsOn) {
        if (!this.nodeMap.has(depId)) {
          errors.push(`Node ${node.id} depends on missing node ${depId}`)
        }
        if (depId === node.id) {
          errors.push(`Node ${node.id} cannot depend on itself`)
        }
      }
    }

    const cycleErrors = this.detectCycles()
    errors.push(...cycleErrors)

    return {
      valid: errors.length === 0,
      errors,
    }
  }

  getReadyNodes(): DagNode[] {
    this.refreshExecutionStatus()

    return this.execution.nodes.filter((node) => {
      if (node.status !== 'pending') return false

      return node.dependsOn.every((depId) => this.nodeMap.get(depId)?.status === 'done')
    })
  }

  markDone(nodeId: string, result: unknown): void {
    const node = this.getNodeOrThrow(nodeId)
    const blockedBy = node.dependsOn.find((depId) => this.nodeMap.get(depId)?.status !== 'done')
    if (blockedBy) {
      throw new Error(`Cannot mark node ${nodeId} done before dependency ${blockedBy} completes`)
    }

    const now = Date.now()
    if (!node.startedAt) node.startedAt = now
    node.status = 'done'
    node.result = result
    node.error = undefined
    node.endedAt = now

    this.refreshExecutionStatus()
  }

  markFailed(nodeId: string, error: string): void {
    const node = this.getNodeOrThrow(nodeId)
    const now = Date.now()
    if (!node.startedAt) node.startedAt = now
    node.status = 'failed'
    node.error = error
    node.endedAt = now

    this.refreshExecutionStatus()
  }

  isComplete(): boolean {
    return this.execution.nodes.length > 0 && this.execution.nodes.every((node) => node.status === 'done')
  }

  isFailed(): boolean {
    return this.execution.nodes.some((node) => node.status === 'failed')
  }

  topologicalSort(): DagNode[] {
    const validation = this.validate()
    if (!validation.valid) {
      throw new Error(`Invalid DAG: ${validation.errors.join('; ')}`)
    }

    const inDegree = new Map<string, number>()
    const adjacency = new Map<string, string[]>()

    for (const node of this.execution.nodes) {
      inDegree.set(node.id, node.dependsOn.length)
      adjacency.set(node.id, [])
    }

    for (const node of this.execution.nodes) {
      for (const depId of node.dependsOn) {
        adjacency.get(depId)?.push(node.id)
      }
    }

    const queue = this.execution.nodes
      .filter((node) => (inDegree.get(node.id) ?? 0) === 0)
      .map((node) => node.id)
    const sorted: DagNode[] = []

    while (queue.length > 0) {
      const nodeId = queue.shift()!
      const node = this.nodeMap.get(nodeId)
      if (!node) continue

      sorted.push(node)

      for (const nextId of adjacency.get(nodeId) ?? []) {
        const nextInDegree = (inDegree.get(nextId) ?? 0) - 1
        inDegree.set(nextId, nextInDegree)
        if (nextInDegree === 0) {
          queue.push(nextId)
        }
      }
    }

    if (sorted.length !== this.execution.nodes.length) {
      throw new Error('Invalid DAG: cycle detected during topological sort')
    }

    return sorted
  }

  getSummary(): { total: number; done: number; failed: number; pending: number; running: number } {
    const summary = {
      total: this.execution.nodes.length,
      done: 0,
      failed: 0,
      pending: 0,
      running: 0,
    }

    for (const node of this.execution.nodes) {
      summary[node.status] += 1
    }

    return summary
  }

  private getNodeOrThrow(nodeId: string): DagNode {
    const node = this.nodeMap.get(nodeId)
    if (!node) {
      throw new Error(`DAG node not found: ${nodeId}`)
    }
    return node
  }

  private detectCycles(): string[] {
    const errors: string[] = []
    const visiting = new Set<string>()
    const visited = new Set<string>()
    const stack: string[] = []

    const visit = (nodeId: string): void => {
      if (visited.has(nodeId)) return
      if (visiting.has(nodeId)) {
        const start = stack.indexOf(nodeId)
        const cycle = [...stack.slice(start), nodeId]
        errors.push(`Cycle detected: ${cycle.join(' -> ')}`)
        return
      }

      visiting.add(nodeId)
      stack.push(nodeId)

      const node = this.nodeMap.get(nodeId)
      for (const depId of node?.dependsOn ?? []) {
        if (this.nodeMap.has(depId)) {
          visit(depId)
        }
      }

      stack.pop()
      visiting.delete(nodeId)
      visited.add(nodeId)
    }

    for (const node of this.execution.nodes) {
      visit(node.id)
    }

    return [...new Set(errors)]
  }

  private refreshExecutionStatus(): void {
    if (this.execution.nodes.length === 0) {
      this.execution.status = 'pending'
      this.execution.completedAt = undefined
      return
    }

    if (this.isFailed()) {
      this.execution.status = 'failed'
      this.execution.completedAt = Date.now()
      return
    }

    if (this.isComplete()) {
      this.execution.status = 'done'
      this.execution.completedAt = Date.now()
      return
    }

    if (this.execution.nodes.some((node) => node.status === 'running' || node.status === 'done')) {
      this.execution.status = 'running'
      this.execution.completedAt = undefined
      return
    }

    this.execution.status = 'pending'
    this.execution.completedAt = undefined
  }
}
