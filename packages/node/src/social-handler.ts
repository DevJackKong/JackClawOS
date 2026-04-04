/**
 * Node Social Handler
 *
 * 处理 Hub 通过 WebSocket 推送的 social 事件：
 * - 'social'                 — 收到社交消息
 * - 'social_contact_request' — 收到联系请求
 * - 'social_contact_response'— 联系请求结果
 *
 * 主人回复通过 Hub /api/social/reply 转发
 */

import type { SocialMessage, ContactRequest } from '@jackclaw/protocol'

export interface SocialHandlerOptions {
  nodeId: string
  agentHandle?: string
  hubUrl: string
  /** 主人的 webhook URL，有则推送通知 */
  webhookUrl?: string
  /** 主人 humanId，用于推送目标 */
  humanId?: string
}

export class SocialHandler {
  constructor(private opts: SocialHandlerOptions) {}

  /** 处理 WebSocket 收到的事件 */
  handleEvent(event: string, data: unknown): void {
    switch (event) {
      case 'social':
        this._onSocialMessage(data as SocialMessage)
        break
      case 'social_contact_request':
        this._onContactRequest(data as ContactRequest)
        break
      case 'social_contact_response':
        this._onContactResponse(data as { requestId: string; decision: string; message?: string })
        break
      default:
        // 不是 social 事件，忽略
        break
    }
  }

  private _onSocialMessage(msg: SocialMessage): void {
    const from = msg.fromAgent
    const content = msg.content.slice(0, 120)
    console.log(`[social] 📨 Message from ${from}: ${content}`)

    if (this.opts.webhookUrl) {
      this._pushToOwner({
        type: 'social_message',
        from,
        content: msg.content,
        messageId: msg.id,
        thread: msg.thread,
        ts: msg.ts,
      })
    }
  }

  private _onContactRequest(req: ContactRequest): void {
    console.log(`[social] 🤝 Contact request from ${req.fromAgent}: "${req.message}"`)

    if (this.opts.webhookUrl) {
      this._pushToOwner({
        type: 'social_contact_request',
        fromAgent: req.fromAgent,
        message: req.message,
        purpose: req.purpose,
        requestId: req.id,
        ts: req.ts,
      })
    }
  }

  private _onContactResponse(resp: { requestId: string; decision: string; message?: string }): void {
    const verb = resp.decision === 'accept' ? '接受了' : '拒绝了'
    console.log(`[social] 📋 Contact request ${resp.requestId} ${verb}`)

    if (this.opts.webhookUrl) {
      this._pushToOwner({
        type: 'social_contact_response',
        requestId: resp.requestId,
        decision: resp.decision,
        message: resp.message,
      })
    }
  }

  /**
   * 主人通过 webhookUrl 的推送（fire-and-forget）
   */
  private _pushToOwner(payload: Record<string, unknown>): void {
    const url = this.opts.webhookUrl!
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'jackclaw-social', nodeId: this.opts.nodeId, ...payload }),
    }).catch((err: Error) => {
      console.warn(`[social] webhook push failed: ${err.message}`)
    })
  }

  /**
   * 主人回复某条社交消息（通过 Hub /api/social/reply 转发）
   */
  async ownerReply(opts: {
    replyToId: string
    content: string
    fromHuman: string
    fromAgent: string
  }): Promise<void> {
    const res = await fetch(`${this.opts.hubUrl}/api/social/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        replyToId: opts.replyToId,
        fromHuman: opts.fromHuman,
        fromAgent: opts.fromAgent,
        content: opts.content,
        type: 'text',
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`[social] reply failed: ${res.status} ${body}`)
    }

    const data = await res.json() as { status: string; messageId: string }
    console.log(`[social] Reply sent: ${data.messageId}`)
  }
}
