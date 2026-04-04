/**
 * channel.ts — Unified IM channel interface definitions for ClawChat bridge
 */

export interface ChannelConfig {
  token?: string
  apiKey?: string
  appId?: string
  appSecret?: string
  webhookUrl?: string
  [key: string]: any
}

export interface IncomingMessage {
  channel: string
  senderId: string
  senderName: string
  chatId: string
  chatType: 'direct' | 'group'
  content: string
  attachments?: { type: string; url: string; filename?: string }[]
  replyTo?: string
  ts: number
  raw: any // original platform data
}

export interface MessageContent {
  text?: string
  markdown?: string
  image?: string
  file?: { url: string; filename: string }
  replyTo?: string
}

export interface ChannelStatus {
  connected: boolean
  name: string
  uptime: number       // ms since connect()
  messagesSent: number
  messagesReceived: number
}

/**
 * Unified interface every IM adapter must implement.
 * Implementations live in channels/adapters/<name>.ts
 */
export interface Channel {
  /** Platform identifier: 'telegram' | 'wechat' | 'feishu' | 'whatsapp' | 'discord' */
  name: string

  /** Establish connection using the given config */
  connect(config: ChannelConfig): Promise<void>

  /** Tear down connection cleanly */
  disconnect(): Promise<void>

  /** Send a message to the given target (user/group id) */
  sendMessage(target: string, content: MessageContent): Promise<void>

  /** Register a handler for incoming messages */
  onMessage(handler: (msg: IncomingMessage) => void): void

  /** Quick liveness check */
  isConnected(): boolean

  /** Detailed status snapshot */
  getStatus(): ChannelStatus
}
