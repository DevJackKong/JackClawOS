export enum TaskPriority {
  urgent = 'urgent',
  high = 'high',
  normal = 'normal',
  low = 'low',
}

export interface QueuedTask<T = unknown> {
  taskId: string
  priority: TaskPriority
  payload: T
  enqueuedAt: number
  retryCount: number
}

export class PriorityQueue<T = unknown> {
  private static readonly priorityOrder: readonly TaskPriority[] = [
    TaskPriority.urgent,
    TaskPriority.high,
    TaskPriority.normal,
    TaskPriority.low,
  ]

  private readonly buckets = new Map<TaskPriority, Array<QueuedTask<T>>>(
    PriorityQueue.priorityOrder.map(priority => [priority, []]),
  )

  enqueue(task: QueuedTask<T>): void {
    this.getBucket(task.priority).push({
      ...task,
      payload: task.payload,
    })
  }

  dequeue(): QueuedTask<T> | undefined {
    for (const priority of PriorityQueue.priorityOrder) {
      const bucket = this.getBucket(priority)
      const task = bucket.shift()
      if (task) {
        return task
      }
    }

    return undefined
  }

  peek(): QueuedTask<T> | undefined {
    for (const priority of PriorityQueue.priorityOrder) {
      const bucket = this.getBucket(priority)
      const task = bucket[0]
      if (task) {
        return task
      }
    }

    return undefined
  }

  size(): number {
    let total = 0

    for (const priority of PriorityQueue.priorityOrder) {
      total += this.getBucket(priority).length
    }

    return total
  }

  isEmpty(): boolean {
    return this.size() === 0
  }

  requeue(task: QueuedTask<T>, priority: TaskPriority = task.priority): void {
    this.enqueue({
      ...task,
      priority,
      retryCount: task.retryCount + 1,
      enqueuedAt: Date.now(),
    })
  }

  clear(): void {
    for (const priority of PriorityQueue.priorityOrder) {
      this.getBucket(priority).length = 0
    }
  }

  private getBucket(priority: TaskPriority): Array<QueuedTask<T>> {
    const bucket = this.buckets.get(priority)

    if (!bucket) {
      throw new Error(`Unsupported task priority: ${priority}`)
    }

    return bucket
  }
}
