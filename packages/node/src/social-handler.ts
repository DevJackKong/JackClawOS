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
import { MessageFilter } from './ai-filter'
import { getEmotionSensor, type Sentiment } from './ai-emotion'
import type { AiClient } from './ai-client'
import type { OwnerMemory } from './owner-memory'
import { getTranslator } from './ai-translator'

export interface SocialHandlerOptions {
  nodeId: string
  agentHandle?: string
  hubUrl: string
  /** 主人的 webhook URL，有则推送通知 */
  webhookUrl?: string
  /** 主人 humanId，用于推送目标 */
  humanId?: string
  /** AiClient 实例，用于翻译 */
  aiClient?: AiClient
  /** OwnerMemory 实例，用于记录情绪模式 */
  ownerMemory?: OwnerMemory
}

export class SocialHandler {
  private readonly filter = new MessageFilter()
  private readonly emotion = getEmotionSensor()

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

  private async _onSocialMessage(msg: SocialMessage): Promise<void> {
    const from = msg.fromAgent
    const content = msg.content.slice(0, 120)

    const result = this.filter.analyze(msg)

    if (result.action === 'block') {
      // Silent discard — already logged by MessageFilter
      console.log(`[social] 🚫 Blocked message from ${from}: ${result.reason}`)
      return
    }

    // Emotion analysis
    const emotion = this.emotion.analyze(msg.content)
    const threadId = msg.thread ?? msg.id
    this.emotion.trackMoodHistory(threadId, emotion.sentiment, emotion.confidence)

    // Persist emotion pattern to OwnerMemory (background contact profile)
    this.opts.ownerMemory?.recordEmotionPattern({
      sentiment: emotion.sentiment,
      confidence: emotion.confidence,
      keywords: emotion.keywords,
      threadId,
    })

    // Build emotion hint for owner notification
    const emotionHint = this._emotionHint(emotion.sentiment)

    // Auto-translate incoming message if enabled
    let displayContent = msg.content
    if (this.opts.aiClient) {
      try {
        const translator = getTranslator(this.opts.aiClient)
        const translated = await translator.translateMessage(msg)
        if (translated) {
          displayContent = translated.combined
          console.log(`[social] 🌐 Translated ${translated.fromLang} → ${translated.toLang}`)
        }
      } catch (err) {
        console.warn(`[social] Translation failed: ${(err as Error).message}`)
      }
    }

    if (result.action === 'flag') {
      console.log(`[social] ⚠️  Suspicious message from ${from}: ${content} [${result.reason}]`)
      if (this.opts.webhookUrl) {
        this._pushToOwner({
          type: 'social_message',
          from,
          content: displayContent,
          messageId: msg.id,
          thread: msg.thread,
          ts: msg.ts,
          warning: result.reason,
          filterConfidence: result.confidence,
          emotionHint,
          emotion: emotion.sentiment,
        })
      }
      return
    }

    // action === 'allow'
    console.log(`[social] 📨 Message from ${from}: ${content}${emotionHint ? ` ${emotionHint}` : ''}`)

    if (this.opts.webhookUrl) {
      this._pushToOwner({
        type: 'social_message',
        from,
        content: displayContent,
        messageId: msg.id,
        thread: msg.thread,
        ts: msg.ts,
        emotionHint,
        emotion: emotion.sentiment,
        emotionKeywords: emotion.keywords,
      })
    }
  }

  /** 根据情绪返回给主人的提示文字 */
  private _emotionHint(sentiment: Sentiment): string {
    switch (sentiment) {
      case 'urgent':   return '⚠️ 对方似乎比较着急'
      case 'negative': return '😟 对方情绪有些负面'
      case 'positive': return '😊 对方心情不错'
      default:         return ''
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
   * 如果对方语言与主人语言不同，且 autoTranslate 开启，自动翻译后发送
   */
  async ownerReply(opts: {
    replyToId: string
    content: string
    fromHuman: string
    fromAgent: string
    /** 对方原始消息，用于检测对方语言并自动翻译主人回复 */
    originalMessage?: SocialMessage
  }): Promise<void> {
    let sendContent = opts.content

    if (this.opts.aiClient && opts.originalMessage) {
      try {
        const translator = getTranslator(this.opts.aiClient)
        const pref = translator.getPreference()

        if (pref.autoTranslate) {
          const theirLang = translator.detectLanguage(opts.originalMessage.content)
          const myDetected = translator.detectLanguage(opts.content)

          if (theirLang !== 'unknown' && theirLang !== myDetected) {
            const translated = await translator.translate(opts.content, myDetected, theirLang)
            sendContent = translated
            console.log(`[social] 🌐 Reply translated ${myDetected} → ${theirLang}`)
          }
        }
      } catch (err) {
        console.warn(`[social] Reply translation failed: ${(err as Error).message}`)
      }
    }

    const res = await fetch(`${this.opts.hubUrl}/api/social/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        replyToId: opts.replyToId,
        fromHuman: opts.fromHuman,
        fromAgent: opts.fromAgent,
        content: sendContent,
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
