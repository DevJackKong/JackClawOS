import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { asyncHandler } from '../server'

const router = Router()

const HUB_DIR = path.join(process.env.HOME || '~', '.jackclaw', 'hub')
const WEBHOOKS_FILE = path.join(HUB_DIR, 'webhooks.json')
const ALLOWED_EVENTS = ['message', 'contact_request', 'contact_response'] as const

export type WebhookEvent = typeof ALLOWED_EVENTS[number]

export interface WebhookConfig {
  url: string
  secret?: string
  events: WebhookEvent[]
  enabled: boolean
}

type WebhookStore = Record<string, WebhookConfig>

interface WebhookEnvelope<T = unknown> {
  event: WebhookEvent
  data: T
  ts: number
}

function normalizeHandle(handle: string): string {
  const trimmed = handle.trim()
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`
}

function loadWebhooks(): WebhookStore {
  try {
    if (fs.existsSync(WEBHOOKS_FILE)) {
      return JSON.parse(fs.readFileSync(WEBHOOKS_FILE, 'utf-8')) as WebhookStore
    }
  } catch {
    // ignore and fall back to empty store
  }
  return {}
}

function saveWebhooks(store: WebhookStore): void {
  fs.mkdirSync(path.dirname(WEBHOOKS_FILE), { recursive: true })
  fs.writeFileSync(WEBHOOKS_FILE, JSON.stringify(store, null, 2), 'utf-8')
}

function getAuthedHandle(req: Request): string | null {
  const handle = req.jwtPayload?.role === 'user' && typeof req.jwtPayload.nodeId !== 'string'
    ? (req.jwtPayload as { handle?: string }).handle
    : null
  if (!handle) return null
  return normalizeHandle(handle)
}

function parseEvents(value: unknown): WebhookEvent[] {
  if (!Array.isArray(value) || value.length === 0) return ['message']

  const normalized = value
    .filter((event): event is string => typeof event === 'string')
    .map((event) => event.trim())
    .filter((event): event is WebhookEvent => ALLOWED_EVENTS.includes(event as WebhookEvent))

  return [...new Set(normalized)]
}

function buildSignature(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

async function postWebhook<T>(config: WebhookConfig, payload: WebhookEnvelope<T>): Promise<void> {
  const body = JSON.stringify(payload)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (config.secret) {
    headers['X-JackClaw-Signature'] = buildSignature(config.secret, body)
  }

  const response = await fetch(config.url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(5000),
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
}

async function postWebhookWithRetry<T>(handle: string, config: WebhookConfig, payload: WebhookEnvelope<T>): Promise<void> {
  try {
    await postWebhook(config, payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[webhooks] Delivery failed for ${handle}: ${message}; retrying in 5s`)

    await new Promise((resolve) => setTimeout(resolve, 5000))

    try {
      await postWebhook(config, payload)
    } catch (retryError) {
      const retryMessage = retryError instanceof Error ? retryError.message : String(retryError)
      console.warn(`[webhooks] Retry failed for ${handle}: ${retryMessage}`)
    }
  }
}

export function getWebhookConfig(handle: string): WebhookConfig | null {
  const store = loadWebhooks()
  return store[normalizeHandle(handle)] ?? null
}

export function queueWebhookEvent<T>(handle: string, event: WebhookEvent, data: T): void {
  const normalizedHandle = normalizeHandle(handle)
  const config = getWebhookConfig(normalizedHandle)
  if (!config?.enabled) return
  if (!config.events.includes(event)) return

  const payload: WebhookEnvelope<T> = {
    event,
    data,
    ts: Date.now(),
  }

  setImmediate(() => {
    void postWebhookWithRetry(normalizedHandle, config, payload)
  })
}

router.get('/', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const handle = getAuthedHandle(req)
  if (!handle) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  const config = getWebhookConfig(handle)
  res.json({ handle, webhook: config })
}))

router.post('/', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const handle = getAuthedHandle(req)
  if (!handle) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  const { url, secret, events } = req.body ?? {}
  if (typeof url !== 'string' || !url.trim()) {
    res.status(400).json({ error: 'url is required' })
    return
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    res.status(400).json({ error: 'invalid url' })
    return
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    res.status(400).json({ error: 'url must be http or https' })
    return
  }

  const normalizedEvents = parseEvents(events)
  if (normalizedEvents.length === 0) {
    res.status(400).json({ error: 'invalid events', allowed: ALLOWED_EVENTS })
    return
  }

  const store = loadWebhooks()
  const webhook: WebhookConfig = {
    url: parsedUrl.toString(),
    secret: typeof secret === 'string' && secret.trim() ? secret.trim() : undefined,
    events: normalizedEvents,
    enabled: true,
  }

  store[handle] = webhook
  saveWebhooks(store)

  res.json({ handle, webhook })
}))

router.delete('/', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const handle = getAuthedHandle(req)
  if (!handle) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  const store = loadWebhooks()
  const existed = Boolean(store[handle])
  delete store[handle]
  saveWebhooks(store)

  res.json({ handle, deleted: existed })
}))

router.post('/test', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const handle = getAuthedHandle(req)
  if (!handle) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  const config = getWebhookConfig(handle)
  if (!config?.enabled) {
    res.status(404).json({ error: 'webhook_not_configured' })
    return
  }

  const payload = {
    id: `test-${crypto.randomUUID()}`,
    fromAgent: '@jackclaw.hub',
    toAgent: handle,
    content: 'webhook test',
    type: 'text',
    ts: Date.now(),
    test: true,
  }

  queueWebhookEvent(handle, 'message', payload)
  res.json({ status: 'queued', handle })
}))

export default router
