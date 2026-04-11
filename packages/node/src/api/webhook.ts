/**
 * Webhook push system for task completion events.
 *
 * Notes:
 * - This file is intentionally self-contained so it can be added without
 *   modifying existing source files.
 * - Importing this module installs a lightweight monkey-patch on TaskExecutor
 *   so completed tasks automatically trigger webhook delivery.
 */

import { createHmac, randomUUID } from 'crypto'
import { setTimeout as sleep } from 'timers/promises'
import { TaskExecutor, type TaskRequest, type TaskResult } from '../task-executor'

export type WebhookEvent = 'task.completed'
export type WebhookDeliveryStatus = 'success' | 'failed'

export interface WebhookRegistrationInput {
  url: string
  events: WebhookEvent[]
  secret?: string
}

export interface WebhookRecord {
  id: string
  webhookId: string
  event: WebhookEvent
  status: WebhookDeliveryStatus
  timestamp: number
  attempt: number
  response: {
    statusCode?: number
    statusText?: string
    body?: string
    error?: string
  }
}

export interface RegisteredWebhook extends WebhookRegistrationInput {
  id: string
  createdAt: number
}

export interface TaskCompletedPayload {
  event: 'task.completed'
  timestamp: number
  task: {
    id: string
    type: TaskRequest['type']
    prompt: string
    context?: string
    status: TaskResult['status']
    output: string
    model: string
    duration: number
    tokenUsage: TaskResult['tokenUsage']
    error?: string
  }
}

export class WebhookManager {
  private readonly webhooks = new Map<string, RegisteredWebhook>()
  private readonly records = new Map<string, WebhookRecord[]>()
  private static singleton?: WebhookManager
  private static patchInstalled = false

  static getInstance(): WebhookManager {
    if (!this.singleton) this.singleton = new WebhookManager()
    return this.singleton
  }

  register(input: WebhookRegistrationInput): RegisteredWebhook {
    this.assertValidUrl(input.url)
    if (!Array.isArray(input.events) || input.events.length === 0) {
      throw new Error('Webhook events are required')
    }

    const events = Array.from(new Set(input.events))
    for (const event of events) {
      if (event !== 'task.completed') {
        throw new Error(`Unsupported webhook event: ${event}`)
      }
    }

    const webhook: RegisteredWebhook = {
      id: randomUUID(),
      url: input.url,
      events,
      secret: input.secret,
      createdAt: Date.now(),
    }

    this.webhooks.set(webhook.id, webhook)
    this.records.set(webhook.id, [])
    return webhook
  }

  list(): RegisteredWebhook[] {
    return Array.from(this.webhooks.values())
  }

  getRecords(webhookId?: string): WebhookRecord[] {
    if (webhookId) return [...(this.records.get(webhookId) ?? [])]
    return Array.from(this.records.values()).flat().sort((a, b) => b.timestamp - a.timestamp)
  }

  async notifyTaskCompleted(task: TaskRequest, result: TaskResult): Promise<WebhookRecord[]> {
    const payload: TaskCompletedPayload = {
      event: 'task.completed',
      timestamp: Date.now(),
      task: {
        id: task.id,
        type: task.type,
        prompt: task.prompt,
        context: task.context,
        status: result.status,
        output: result.output,
        model: result.model,
        duration: result.duration,
        tokenUsage: result.tokenUsage,
        error: result.error,
      },
    }

    const targets = this.list().filter(webhook => webhook.events.includes('task.completed'))
    const deliveries = await Promise.all(targets.map(webhook => this.deliverWithRetry(webhook, payload)))
    return deliveries.flat()
  }

  installTaskCompletionHook(): void {
    if (WebhookManager.patchInstalled) return
    WebhookManager.patchInstalled = true

    const manager = this
    const originalExecute = TaskExecutor.prototype.execute
    const originalExecuteWithTools = TaskExecutor.prototype.executeWithTools

    TaskExecutor.prototype.execute = async function patchedExecute(task: TaskRequest): Promise<TaskResult> {
      const result = await originalExecute.call(this, task)
      await manager.dispatchIfCompleted(task, result)
      return result
    }

    TaskExecutor.prototype.executeWithTools = async function patchedExecuteWithTools(
      task: TaskRequest,
      tools,
    ): Promise<TaskResult> {
      const result = await originalExecuteWithTools.call(this, task, tools)
      await manager.dispatchIfCompleted(task, result)
      return result
    }
  }

  private async dispatchIfCompleted(task: TaskRequest, result: TaskResult): Promise<void> {
    if (result.status !== 'completed') return
    try {
      await this.notifyTaskCompleted(task, result)
    } catch (error) {
      console.error('[webhook] task completion dispatch failed:', (error as Error).message)
    }
  }

  private async deliverWithRetry(
    webhook: RegisteredWebhook,
    payload: TaskCompletedPayload,
  ): Promise<WebhookRecord[]> {
    const event: WebhookEvent = 'task.completed'
    const records: WebhookRecord[] = []

    for (let attempt = 1; attempt <= 3; attempt++) {
      const timestamp = Date.now()
      try {
        const body = JSON.stringify(payload)
        const response = await fetch(webhook.url, {
          method: 'POST',
          headers: this.buildHeaders(webhook, body, timestamp),
          body,
        })

        const responseBody = await response.text()
        const record: WebhookRecord = {
          id: randomUUID(),
          webhookId: webhook.id,
          event,
          status: response.ok ? 'success' : 'failed',
          timestamp,
          attempt,
          response: {
            statusCode: response.status,
            statusText: response.statusText,
            body: responseBody,
          },
        }

        this.appendRecord(record)
        records.push(record)

        if (response.ok) break
      } catch (error) {
        const record: WebhookRecord = {
          id: randomUUID(),
          webhookId: webhook.id,
          event,
          status: 'failed',
          timestamp,
          attempt,
          response: {
            error: error instanceof Error ? error.message : String(error),
          },
        }

        this.appendRecord(record)
        records.push(record)
      }

      if (attempt < 3) {
        await sleep(this.getBackoffMs(attempt))
      }
    }

    return records
  }

  private buildHeaders(webhook: RegisteredWebhook, body: string, timestamp: number): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-webhook-event': 'task.completed',
      'x-webhook-timestamp': String(timestamp),
    }

    if (webhook.secret) {
      headers['x-webhook-signature'] = this.sign(body, webhook.secret, timestamp)
    }

    return headers
  }

  private sign(body: string, secret: string, timestamp: number): string {
    const digest = createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('hex')
    return `sha256=${digest}`
  }

  private getBackoffMs(attempt: number): number {
    return 500 * 2 ** (attempt - 1)
  }

  private appendRecord(record: WebhookRecord): void {
    const existing = this.records.get(record.webhookId) ?? []
    existing.unshift(record)
    this.records.set(record.webhookId, existing)
  }

  private assertValidUrl(url: string): void {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error('Invalid webhook url')
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Webhook url must be http or https')
    }
  }
}

export const webhookManager = WebhookManager.getInstance()
webhookManager.installTaskCompletionHook()

export function registerWebhook(input: WebhookRegistrationInput): RegisteredWebhook {
  return webhookManager.register(input)
}

export function listWebhooks(): RegisteredWebhook[] {
  return webhookManager.list()
}

export function listWebhookRecords(webhookId?: string): WebhookRecord[] {
  return webhookManager.getRecords(webhookId)
}
