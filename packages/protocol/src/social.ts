/**
 * JackClaw Social Communication Protocol
 *
 * 人↔人通过各自的 Agent 互发消息，Agent 作为可信中继。
 * 支持联系请求（名片交换）、社交消息、线程会话。
 */

// ─── File Attachment ──────────────────────────────────────────────────────────

export interface FileAttachment {
  /** Hub 文件 ID */
  fileId: string
  /** 原始文件名 */
  filename: string
  /** 文件大小（字节）*/
  size: number
  /** MIME 类型 */
  mimeType: string
  /** 缩略图 URL（仅图片类型）*/
  thumbnailUrl?: string
}

// ─── Social Message ───────────────────────────────────────────────────────────

export type SocialMessageType = 'text' | 'request' | 'introduction' | 'business'

export interface SocialMessage {
  /** 消息唯一 ID */
  id: string
  /** 发送方人类账号（humanId） */
  fromHuman: string
  /** 发送方 Agent handle（@alice） */
  fromAgent: string
  /** 目标 Agent handle（@bob） */
  toAgent: string
  /** 目标人类账号（可选，Agent 转发时填写） */
  toHuman?: string
  /** 消息正文 */
  content: string
  /** 消息类型 */
  type: SocialMessageType
  /** 回复的消息 ID */
  replyTo?: string
  /** 会话线程 ID */
  thread?: string
  /** 发送时间戳 */
  ts: number
  /** 是否加密 */
  encrypted: boolean
  /** 发送方签名 */
  signature: string
  /** 附件列表（文件/图片）*/
  attachments?: FileAttachment[]
}

// ─── Contact Request ──────────────────────────────────────────────────────────

export type ContactRequestStatus = 'pending' | 'accepted' | 'declined'

export interface ContactRequest {
  id: string
  fromAgent: string
  toAgent: string
  /** 请求附言 */
  message: string
  /** 建立联系的目的 */
  purpose: string
  status: ContactRequestStatus
  ts: number
}

// ─── Contact Response ─────────────────────────────────────────────────────────

export interface ContactResponse {
  requestId: string
  fromAgent: string
  decision: 'accept' | 'decline'
  message?: string
}

// ─── Social Profile (Agent 名片) ──────────────────────────────────────────────

export type ContactPolicy = 'open' | 'request' | 'closed'

export interface SocialProfile {
  /** Agent @handle */
  agentHandle: string
  /** 主人姓名 */
  ownerName: string
  /** 主人头衔 */
  ownerTitle: string
  /** 简介 */
  bio: string
  /** 技能标签 */
  skills: string[]
  /** 联系策略：open=任何人可发消息, request=需申请, closed=拒绝外来消息 */
  contactPolicy: ContactPolicy
  /** Agent 所在 Hub URL */
  hubUrl: string
  /** 最后更新时间 */
  updatedAt: number
}

// ─── Social Thread (会话线程摘要) ─────────────────────────────────────────────

export interface SocialThread {
  id: string
  participants: string[]   // agentHandle[]
  lastMessage?: string
  lastMessageAt: number
  messageCount: number
}
