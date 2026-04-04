/**
 * feishu.ts — Feishu/Lark Open Platform channel adapter for ClawChat bridge
 *
 * Uses Node.js native fetch (Node 20+) and built-in crypto. No npm dependencies.
 * Primary mode: webhook — expose handleWebhookRequest() to your HTTP server.
 * Fallback mode: polling — pass pollChatIds in config to enable periodic pull.
 *
 * AES-256-CBC decryption: key = SHA-256(encryptKey), IV = first 16 bytes of key.
 */

import crypto from 'crypto'
import { Channel, ChannelConfig, IncomingMessage, MessageContent, ChannelStatus } from './channel'

const FEISHU_API = 'https://open.feishu.cn/open-apis'

// ── Feishu API types ──────────────────────────────────────────────────────────

interface FeishuTokenResponse {
  code: number
  msg: string
  tenant_access_token: string
  expire: number
}

interface FeishuSendResponse {
  code: number
  msg: string
  data?: {
    message_id: string
    create_time: string
    update_time: string
    chat_id: string
    msg_type: string
    body: { content: string }
  }
}

/** Event envelope (schema 2.0 + legacy schema 1.0) */
interface FeishuEventEnvelope {
  // schema 2.0
  schema?: string
  header?: {
    event_id: string
    event_type: string
    create_time: string
    token: string
    app_id: string
    tenant_key: string
  }
  event?: FeishuMessageEvent
  // legacy / challenge
  challenge?: string
  token?: string
  type?: string
  // encrypted payload
  encrypt?: string
}

interface FeishuMessageEvent {
  sender?: {
    sender_id?: {
      open_id?: string
      union_id?: string
      user_id?: string
    }
    sender_type?: string
    tenant_key?: string
  }
  message?: {
    message_id: string
    root_id?: string
    parent_id?: string
    create_time: string
    update_time?: string
    chat_id: string
    chat_type: 'p2p' | 'group'
    message_type: string
    content: string // JSON string
    mentions?: Array<{
      key: string
      id: { open_id: string; union_id: string; user_id: string }
      name: string
    }>
  }
}

interface FeishuMessageListItem {
  message_id: string
  root_id?: string
  parent_id?: string
  create_time: string
  update_time?: string
  chat_id: string
  chat_type: 'p2p' | 'group'
  message_type: string
  content: string
  sender: {
    id: string
    id_type: string
    sender_type: string
    tenant_key: string
  }
}

/** Parsed inner message content */
interface FeishuContentText    { text: string }
interface FeishuContentImage   { image_key: string }
interface FeishuContentFile    { file_key: string; file_name?: string }
type FeishuContent = Partial<FeishuContentText & FeishuContentImage & FeishuContentFile>

// ── FeishuChannel ─────────────────────────────────────────────────────────────

export class FeishuChannel implements Channel {
  readonly name = 'feishu'

  private appId = ''
  private appSecret = ''
  private verificationToken = ''
  private encryptKey = ''

  /** Current tenant_access_token */
  private accessToken = ''
  /** Epoch ms when the token should be considered expired */
  private tokenExpiresAt = 0
  private tokenRefreshTimer: NodeJS.Timeout | null = null

  private messageHandler: ((msg: IncomingMessage) => void) | null = null
  private connected = false
  private connectedAt = 0
  private messagesSent = 0
  private messagesReceived = 0

  /** Polling mode: list of chat_ids to pull periodically */
  private pollChatIds: string[] = []
  private pollInterval = 10_000
  private pollTimer: NodeJS.Timeout | null = null
  /** Per-chat last-seen create_time (ms) to avoid re-dispatching */
  private pollLastTs: Record<string, number> = {}

  // ------------------------------------------------------------------ token

  private async fetchToken(): Promise<void> {
    const res = await fetch(`${FEISHU_API}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
    })
    const json = (await res.json()) as FeishuTokenResponse
    if (json.code !== 0) throw new Error(`[FeishuChannel] token fetch failed: ${json.msg}`)

    this.accessToken = json.tenant_access_token
    // Schedule refresh 60 seconds before actual expiry
    const ttlMs = (json.expire - 60) * 1000
    this.tokenExpiresAt = Date.now() + ttlMs

    if (this.tokenRefreshTimer) clearTimeout(this.tokenRefreshTimer)
    this.tokenRefreshTimer = setTimeout(() => {
      this.fetchToken().catch(e => console.error('[FeishuChannel] token auto-refresh error:', e))
    }, ttlMs)
  }

  private async ensureToken(): Promise<void> {
    if (!this.accessToken || Date.now() >= this.tokenExpiresAt) {
      await this.fetchToken()
    }
  }

  private get authHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    }
  }

  // ------------------------------------------------------------------ HTTP helpers

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    await this.ensureToken()
    const res = await fetch(`${FEISHU_API}${path}`, {
      method: 'POST',
      headers: this.authHeaders,
      body: JSON.stringify(body),
    })
    return res.json() as Promise<T>
  }

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    await this.ensureToken()
    const url = new URL(`${FEISHU_API}${path}`)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    const res = await fetch(url.toString(), { headers: this.authHeaders })
    return res.json() as Promise<T>
  }

  // ------------------------------------------------------------------ decryption

  /**
   * Decrypt Feishu AES-256-CBC payload.
   * key  = SHA-256(encryptKey)
   * iv   = first 16 bytes of key
   * data = base64-decoded ciphertext
   */
  private decrypt(encrypted: string): string {
    const key = crypto.createHash('sha256').update(this.encryptKey).digest()
    const iv = key.slice(0, 16)
    const data = Buffer.from(encrypted, 'base64')
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
    decipher.setAutoPadding(true)
    const plain = Buffer.concat([decipher.update(data), decipher.final()])
    return plain.toString('utf8')
  }

  // ------------------------------------------------------------------ content parsing

  private parseContent(rawContent: string): {
    text: string
    attachments: NonNullable<IncomingMessage['attachments']>
  } {
    let text = ''
    const attachments: NonNullable<IncomingMessage['attachments']> = []
    try {
      const c = JSON.parse(rawContent) as FeishuContent
      text = c.text ?? ''
      if (c.image_key) {
        attachments.push({ type: 'image', url: `feishu://image/${c.image_key}` })
      }
      if (c.file_key) {
        attachments.push({
          type: 'file',
          url: `feishu://file/${c.file_key}`,
          filename: c.file_name,
        })
      }
    } catch {
      // Unrecognised format — treat raw string as text
      text = rawContent
    }
    return { text, attachments }
  }

  // ------------------------------------------------------------------ event dispatch

  private dispatchEvent(envelope: FeishuEventEnvelope): void {
    const eventBody = envelope.event
    const header = envelope.header

    if (!header || !eventBody) return
    if (header.event_type !== 'im.message.receive_v1') return

    const { message, sender } = eventBody
    if (!message || !this.messageHandler) return

    const { text, attachments } = this.parseContent(message.content)
    const senderId =
      sender?.sender_id?.open_id ??
      sender?.sender_id?.union_id ??
      sender?.sender_id?.user_id ??
      'unknown'

    const incoming: IncomingMessage = {
      channel: this.name,
      senderId,
      senderName: senderId,
      chatId: message.chat_id,
      chatType: message.chat_type === 'p2p' ? 'direct' : 'group',
      content: text,
      attachments: attachments.length ? attachments : undefined,
      replyTo: message.parent_id,
      ts: Number(message.create_time),
      raw: envelope,
    }

    this.messagesReceived++
    this.messageHandler(incoming)
  }

  // ------------------------------------------------------------------ polling

  private async pollOnce(): Promise<void> {
    for (const chatId of this.pollChatIds) {
      try {
        const since = this.pollLastTs[chatId] ?? Date.now() - 60_000

        const data = await this.get<{
          code: number
          msg: string
          data?: { items?: FeishuMessageListItem[]; has_more: boolean }
        }>('/im/v1/messages', {
          container_id_type: 'chat',
          container_id: chatId,
          start_time: String(Math.floor(since / 1000)),
          page_size: '50',
          sort_type: 'ByCreateTimeAsc',
        })

        if (data.code !== 0 || !data.data?.items?.length) continue

        for (const item of data.data.items) {
          const ts = Number(item.create_time)
          if (ts <= (this.pollLastTs[chatId] ?? 0)) continue

          // Track newest timestamp
          if (ts > (this.pollLastTs[chatId] ?? 0)) {
            this.pollLastTs[chatId] = ts
          }

          if (!this.messageHandler) continue

          const { text, attachments } = this.parseContent(item.content)

          const incoming: IncomingMessage = {
            channel: this.name,
            senderId: item.sender.id,
            senderName: item.sender.id,
            chatId: item.chat_id,
            chatType: item.chat_type === 'p2p' ? 'direct' : 'group',
            content: text,
            attachments: attachments.length ? attachments : undefined,
            ts,
            raw: item,
          }

          this.messagesReceived++
          this.messageHandler(incoming)
        }
      } catch (e) {
        console.error(`[FeishuChannel] poll error (chat=${chatId}):`, e)
      }
    }
  }

  // ------------------------------------------------------------------ Channel interface

  async connect(config: ChannelConfig): Promise<void> {
    if (!config.appId) throw new Error('[FeishuChannel] appId is required')
    if (!config.appSecret) throw new Error('[FeishuChannel] appSecret is required')

    this.appId             = config.appId
    this.appSecret         = config.appSecret
    this.verificationToken = config.verificationToken ?? ''
    this.encryptKey        = config.encryptKey ?? ''
    this.pollChatIds       = Array.isArray(config.pollChatIds) ? config.pollChatIds as string[] : []
    this.pollInterval      = typeof config.pollInterval === 'number' ? config.pollInterval : 10_000

    await this.fetchToken()

    this.connected   = true
    this.connectedAt = Date.now()

    if (this.pollChatIds.length > 0) {
      this.pollTimer = setInterval(() => {
        this.pollOnce().catch(e => console.error('[FeishuChannel] poll error:', e))
      }, this.pollInterval)
      console.log(
        `[FeishuChannel] polling mode active: ${this.pollChatIds.length} chat(s), interval=${this.pollInterval}ms`,
      )
    } else {
      console.log(
        '[FeishuChannel] webhook mode: wire handleWebhookRequest() to your POST /webhook/feishu endpoint',
      )
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false
    if (this.tokenRefreshTimer) { clearTimeout(this.tokenRefreshTimer); this.tokenRefreshTimer = null }
    if (this.pollTimer)         { clearInterval(this.pollTimer);        this.pollTimer = null }
  }

  async sendMessage(target: string, content: MessageContent): Promise<void> {
    let msgType: string
    let msgContent: string

    if (content.image) {
      msgType    = 'image'
      msgContent = JSON.stringify({ image_key: content.image })
    } else if (content.file) {
      msgType    = 'file'
      msgContent = JSON.stringify({ file_key: content.file.url, file_name: content.file.filename })
    } else {
      msgType    = 'text'
      msgContent = JSON.stringify({ text: content.text ?? content.markdown ?? '' })
    }

    const res = await this.post<FeishuSendResponse>(
      '/im/v1/messages?receive_id_type=chat_id',
      {
        receive_id: target,
        msg_type:   msgType,
        content:    msgContent,
        ...(content.replyTo ? { reply_in_thread: false, root_id: content.replyTo } : {}),
      },
    )

    if (res.code !== 0) throw new Error(`[FeishuChannel] sendMessage failed: ${res.msg}`)
    this.messagesSent++
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.messageHandler = handler
  }

  isConnected(): boolean {
    return this.connected
  }

  getStatus(): ChannelStatus {
    return {
      connected:        this.connected,
      name:             this.name,
      uptime:           this.connected ? Date.now() - this.connectedAt : 0,
      messagesSent:     this.messagesSent,
      messagesReceived: this.messagesReceived,
    }
  }

  // ------------------------------------------------------------------ webhook handler

  /**
   * Process an inbound Feishu webhook request.
   * Wire into your HTTP server's POST handler, e.g.:
   *
   *   app.post('/webhook/feishu', express.text({ type: '*\/*' }), async (req, res) => {
   *     const { status, body } = await feishu.handleWebhookRequest(req.body)
   *     res.status(status).send(body)
   *   })
   *
   * @param rawBody  Raw request body as a string
   * @returns        HTTP status code and body to return to Feishu
   */
  async handleWebhookRequest(rawBody: string): Promise<{ status: number; body: string }> {
    let envelope: FeishuEventEnvelope
    try {
      envelope = JSON.parse(rawBody) as FeishuEventEnvelope
    } catch {
      return { status: 400, body: JSON.stringify({ error: 'invalid json' }) }
    }

    // Decrypt if encryptKey is configured and payload is encrypted
    if (envelope.encrypt) {
      if (!this.encryptKey) {
        console.error('[FeishuChannel] received encrypted event but encryptKey is not configured')
        return { status: 400, body: JSON.stringify({ error: 'no encryptKey configured' }) }
      }
      try {
        const decrypted = this.decrypt(envelope.encrypt)
        envelope = JSON.parse(decrypted) as FeishuEventEnvelope
      } catch (e) {
        console.error('[FeishuChannel] decryption error:', e)
        return { status: 400, body: JSON.stringify({ error: 'decryption failed' }) }
      }
    }

    // Token verification (non-fatal if token not configured — rely on encryptKey or network controls)
    if (this.verificationToken) {
      const token = envelope.token ?? envelope.header?.token
      if (token && token !== this.verificationToken) {
        console.warn('[FeishuChannel] webhook token mismatch — rejecting request')
        return { status: 403, body: JSON.stringify({ error: 'invalid token' }) }
      }
    }

    // URL verification handshake
    if (envelope.type === 'url_verification' || envelope.challenge) {
      return { status: 200, body: JSON.stringify({ challenge: envelope.challenge }) }
    }

    // Dispatch asynchronously so we can return 200 immediately
    try {
      this.dispatchEvent(envelope)
    } catch (e) {
      console.error('[FeishuChannel] dispatchEvent error:', e)
    }

    return { status: 200, body: JSON.stringify({ code: 0 }) }
  }
}
