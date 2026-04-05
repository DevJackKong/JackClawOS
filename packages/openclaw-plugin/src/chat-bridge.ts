/**
 * chat-bridge.ts — Lightweight WebSocket client for Hub /chat/ws endpoint.
 *
 * Features:
 *   - Exponential back-off reconnect: 1 s → 60 s
 *   - Offline message queue — flushed on reconnect
 *   - Hub heartbeat: responds to WS ping frames with pong
 */

import WebSocket from 'ws'

export interface ChatEnvelope {
  to: string
  content: string
  type?: string
}

type MessageHandler = (msg: Record<string, unknown>) => void

export class PluginChatClient {
  private readonly hubUrl: string
  private readonly token: string

  private ws: WebSocket | null = null
  private reconnectDelay = 1000          // start at 1 s
  private readonly maxDelay = 60_000     // cap at 60 s
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private stopping = false

  private readonly messageHandlers: MessageHandler[] = []
  private readonly queue: ChatEnvelope[] = []   // messages queued while offline

  constructor(hubUrl: string, token: string) {
    this.hubUrl = hubUrl.replace(/\/+$/, '')      // strip trailing slash
    this.token = token
  }

  /** Open the WebSocket connection. */
  connect(): void {
    this.stopping = false
    this._open()
  }

  /** Send a message to `to`. Queues if currently disconnected. */
  send(to: string, content: string, type = 'human'): void {
    const envelope: ChatEnvelope = { to, content, type }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(envelope))
    } else {
      this.queue.push(envelope)
    }
  }

  /** Register a handler for inbound messages. */
  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler)
  }

  /** Whether the socket is currently open. */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  /** Close the connection and stop reconnecting. */
  stop(): void {
    this.stopping = true
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.removeAllListeners()
      this.ws.terminate()
      this.ws = null
    }
  }

  // ── private ──────────────────────────────────────────────────────────────────

  private _open(): void {
    if (this.stopping) return

    // Convert http(s) → ws(s); if already ws, keep as-is
    const wsBase = this.hubUrl
      .replace(/^https:\/\//, 'wss://')
      .replace(/^http:\/\//, 'ws://')

    const url = `${wsBase}/chat/ws?token=${encodeURIComponent(this.token)}`

    const ws = new WebSocket(url)
    this.ws = ws

    ws.on('open', () => {
      this.reconnectDelay = 1000  // reset on successful connect
      this._flushQueue()
    })

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>
        for (const h of this.messageHandlers) h(msg)
      } catch {
        // ignore non-JSON frames
      }
    })

    ws.on('ping', () => {
      ws.pong()
    })

    ws.on('close', () => {
      this.ws = null
      this._scheduleReconnect()
    })

    ws.on('error', () => {
      // 'close' fires after 'error', so reconnect is handled there
    })
  }

  private _flushQueue(): void {
    while (this.queue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
      const envelope = this.queue.shift()!
      this.ws.send(JSON.stringify(envelope))
    }
  }

  private _scheduleReconnect(): void {
    if (this.stopping) return
    if (this.reconnectTimer !== null) return

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      // Exponential back-off with cap
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay)
      this._open()
    }, this.reconnectDelay)
  }
}

// ── Module-level singleton ────────────────────────────────────────────────────

let _instance: PluginChatClient | null = null

export function getPluginChatClient(): PluginChatClient | null {
  return _instance
}

export function initPluginChatClient(hubUrl: string, token: string): PluginChatClient {
  _instance = new PluginChatClient(hubUrl, token)
  return _instance
}
