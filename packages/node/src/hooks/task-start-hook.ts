import { EventRetriever } from '@jackclaw/memory'
import type { TriggerEvent, TriggerType } from '@jackclaw/memory'

export class TaskStartHook {
  private readonly retriever: EventRetriever

  constructor(private readonly nodeId: string) {
    this.retriever = new EventRetriever(nodeId)
  }

  async onTaskStart(task: {
    taskId: string
    taskType: string
    payload: Record<string, unknown>
  }): Promise<{
    memoryContext: string
    relevantMemories: any[]
    hitCount: number
  }> {
    const event = this.buildTriggerEvent(task)
    const relevantMemories = await this.retriever.retrieve(event)

    return {
      memoryContext: this.formatMemoryContext(relevantMemories),
      relevantMemories,
      hitCount: relevantMemories.length,
    }
  }

  private buildTriggerEvent(task: {
    taskId: string
    taskType: string
    payload: Record<string, unknown>
  }): TriggerEvent {
    const context: Record<string, string> = {
      taskId: task.taskId,
      taskType: task.taskType,
    }

    for (const [key, value] of Object.entries(task.payload ?? {})) {
      const normalized = this.stringifyValue(value)
      if (normalized) {
        context[key] = normalized
      }
    }

    return {
      type: this.mapTaskTypeToTrigger(task.taskType, task.payload),
      context,
    }
  }

  private mapTaskTypeToTrigger(
    taskType: string,
    payload: Record<string, unknown>,
  ): TriggerType {
    const normalizedType = taskType.trim().toLowerCase()
    const searchable = [
      normalizedType,
      ...Object.keys(payload ?? {}).map(key => key.toLowerCase()),
      ...Object.values(payload ?? {}).map(value => this.stringifyValue(value).toLowerCase()),
    ].join(' ')

    if (this.containsAny(searchable, ['deploy', 'release', 'publish', 'ship', 'rollout'])) {
      return 'deploy'
    }

    if (this.containsAny(searchable, ['error', 'exception', 'fail', 'failure', 'bug', 'stack', 'trace'])) {
      return 'tool-error'
    }

    if (this.containsAny(searchable, ['mention', 'message', 'chat', 'human', 'user'])) {
      return 'user-mention'
    }

    if (this.containsAny(searchable, ['retry', 'retries', 'repeat', 'repeated', 'loop'])) {
      return 'repeated-failure'
    }

    return 'repo'
  }

  private formatMemoryContext(memories: any[]): string {
    if (!memories.length) return ''

    const lines = memories
      .map(memory => {
        const parts = [
          this.cleanText(memory?.content),
          this.cleanText(memory?.why),
          this.cleanText(memory?.howToApply),
        ].filter(Boolean)

        const summary = parts.join('；')
        return summary ? `- ${summary}` : ''
      })
      .filter(Boolean)

    if (!lines.length) return ''

    return ['【相关经验】', ...lines].join('\n')
  }

  private stringifyValue(value: unknown): string {
    if (value == null) return ''
    if (typeof value === 'string') return value.trim()
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return String(value)
    }

    if (Array.isArray(value)) {
      return value
        .map(item => this.stringifyValue(item))
        .filter(Boolean)
        .join(' ')
    }

    if (typeof value === 'object') {
      try {
        return JSON.stringify(value)
      } catch {
        return ''
      }
    }

    return ''
  }

  private cleanText(value: unknown): string {
    return this.stringifyValue(value).replace(/\s+/g, ' ').trim()
  }

  private containsAny(haystack: string, needles: string[]): boolean {
    return needles.some(needle => haystack.includes(needle))
  }
}
