/**
 * AutoReplyHandler — Node 收到 ClawChat 消息后自动调 LLM 生成回复
 *
 * 使用方式：
 *   const handler = new AutoReplyHandler({
 *     nodeId: "cto-agent",
 *     hubUrl: "http://localhost:3100",
 *     systemPrompt: "你是 CTO，负责技术架构决策",
 *     model: "claude-3-5-sonnet-20241022",
 *     llmGateway: gateway,           // 可选，传入已有 LLMGateway 实例
 *     openclawGatewayUrl: "http://...", // 可选，调 OpenClaw Gateway /v1/chat/completions
 *   })
 *   handler.start()
 *   handler.stop()
 */
import WebSocket from 'ws'
import type { LLMGateway } from '@jackclaw/llm-gateway'
import type { ChatMessage } from '@jackclaw/llm-gateway'

export interface AutoReplyOptions {
  nodeId: string
  hubUrl: string
  /** LLM 角色定义，注入为 system message */
  systemPrompt?: string
  /** 模型名称，透传给 Gateway；默认 claude-3-5-haiku-20241022 */
  model?: string
  /** 可选：传入已初始化的 LLMGateway 实例 */
  llmGateway?: LLMGateway
  /** 可选：OpenClaw Gateway 兼容接口 URL（/v1/chat/completions） */
  openclawGatewayUrl?: string
  /** 对话历史保留条数，默认 20 */
  historyLimit?: number
}

interface IncomingMsg {
  id: string
  from: string
  to: string
  content: string
  type: string
}

const DEFAULT_MODEL = 'claude-3-5-haiku-20241022'
const DEFAULT_HISTORY_LIMIT = 20

export class AutoReplyHandler {
  private ws: WebSocket | null = null
  private reconnectCount = 0
  private stopped = false
  private connected = false

  // 对话历史（user/assistant 交替），不含 system
  private history: ChatMessage[] = []

  private readonly nodeId: string
  private readonly hubUrl: string
  private readonly systemPrompt: string
  private readonly model: string
  private readonly llmGateway?: LLMGateway
  private readonly openclawGatewayUrl?: string
  private readonly historyLimit: number

  constructor(opts: AutoReplyOptions) {
    this.nodeId = opts.nodeId
    this.hubUrl = opts.hubUrl
    this.systemPrompt = opts.systemPrompt ?? '你是一个智能 AI 助手，请友好、简洁地回复用户消息。'
    this.model = opts.model ?? DEFAULT_MODEL
    this.llmGateway = opts.llmGateway
    this.openclawGatewayUrl = opts.openclawGatewayUrl
    this.historyLimit = opts.historyLimit ?? DEFAULT_HISTORY_LIMIT
  }

  /** 连接 Hub WebSocket，开始监听并自动回复 */
  start() {
    if (this.stopped) return
    this._connect()
  }

  stop() {
    this.stopped = true
    this.ws?.close()
    this.ws = null
  }

  isConnected(): boolean { return this.connected }

  // ── WebSocket ──────────────────────────────────────────────────────

  private _connect() {
    const wsUrl = this.hubUrl.replace(/^http/, 'ws') + `/chat/ws?nodeId=${encodeURIComponent(this.nodeId)}`
    console.log(`[auto-reply] Connecting to ${wsUrl}`)

    this.ws = new WebSocket(wsUrl)

    this.ws.on('open', () => {
      console.log('[auto-reply] Connected to Hub ClawChat')
      this.reconnectCount = 0
      this.connected = true
    })

    this.ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString())
        if (data.event === 'message') {
          this._handleMessage(data.data as IncomingMsg)
        } else if (data.event === 'inbox' && Array.isArray(data.data)) {
          for (const msg of data.data) {
            this._handleMessage(msg as IncomingMsg)
          }
        }
      } catch { /* ignore malformed frames */ }
    })

    this.ws.on('ping', () => { this.ws?.pong() })

    this.ws.on('close', () => {
      this.connected = false
      if (this.stopped) return
      const delay = Math.min(60_000, 1_000 * Math.pow(2, this.reconnectCount++))
      console.log(`[auto-reply] Disconnected, reconnecting in ${delay}ms (#${this.reconnectCount})`)
      setTimeout(() => this._connect(), delay)
    })

    this.ws.on('error', (err) => {
      console.warn('[auto-reply] WS error:', err.message)
    })
  }

  // ── Message routing ───────────────────────────────────────────────

  private _handleMessage(msg: IncomingMsg) {
    // 忽略自己发出的消息（避免回响循环）
    if (msg.from === this.nodeId) return
    // 只处理发给自己的普通消息
    if (msg.to !== this.nodeId) return

    console.log(`[auto-reply] ← ${msg.from}: ${msg.content.slice(0, 80)}`)

    // 追加用户消息到历史
    this.history.push({ role: 'user', content: msg.content })
    this._trimHistory()

    this._generateReply(msg.content)
      .then((reply) => {
        // 追加 assistant 回复到历史
        this.history.push({ role: 'assistant', content: reply })
        this._trimHistory()
        this._sendReply(msg.from, reply)
      })
      .catch((err: Error) => {
        console.error('[auto-reply] LLM error:', err.message)
      })
  }

  // ── LLM 调用 ─────────────────────────────────────────────────────

  private async _generateReply(userContent: string): Promise<string> {
    // 优先级 1：传入的 LLMGateway 实例
    if (this.llmGateway) {
      return this._callGateway(this.llmGateway)
    }

    // 优先级 2：OpenClaw Gateway HTTP 接口
    if (this.openclawGatewayUrl) {
      return this._callOpenClawHttp()
    }

    // 优先级 3：Echo 回复（用于测试/无 LLM 环境）
    return `[echo] 收到：${userContent}`
  }

  /** 通过 LLMGateway 实例调用 */
  private async _callGateway(gateway: LLMGateway): Promise<string> {
    const messages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt },
      ...this.history,
    ]
    const resp = await gateway.chat({ model: this.model, messages })
    return resp.choices?.[0]?.message?.content ?? ''
  }

  /** 通过 OpenClaw Gateway HTTP /v1/chat/completions 调用 */
  private async _callOpenClawHttp(): Promise<string> {
    const messages = [
      { role: 'system', content: this.systemPrompt },
      ...this.history,
    ]

    const res = await fetch(`${this.openclawGatewayUrl!.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, messages }),
    })

    if (!res.ok) {
      throw new Error(`OpenClaw Gateway HTTP ${res.status}: ${await res.text()}`)
    }

    const json = await res.json() as any
    return json.choices?.[0]?.message?.content ?? ''
  }

  // ── Send reply ────────────────────────────────────────────────────

  private _sendReply(to: string, content: string) {
    const id = crypto.randomUUID()
    const payload = JSON.stringify({
      id,
      from: this.nodeId,
      to,
      content,
      type: 'human',
      ts: Date.now(),
      signature: '',
      encrypted: false,
    })

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(payload)
      console.log(`[auto-reply] → ${to}: ${content.slice(0, 80)}`)
    } else {
      console.warn('[auto-reply] Cannot send — WS not open')
    }
  }

  // ── History management ────────────────────────────────────────────

  /** 保持历史在 historyLimit 条以内（成对 user+assistant） */
  private _trimHistory() {
    while (this.history.length > this.historyLimit) {
      this.history.shift()
    }
  }

  /** 清除对话历史（外部可调用，例如开始新对话时） */
  clearHistory() {
    this.history = []
  }
}
