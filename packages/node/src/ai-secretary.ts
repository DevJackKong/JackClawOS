/**
 * AiSecretary — AI 秘书
 *
 * 功能：自动回复、消息优先级分类、未读摘要、每日通信汇报
 * 配置：~/.jackclaw/node/secretary.json
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import type { AiClient } from './ai-client'
import type { OwnerMemory } from './owner-memory'

// ─── Types ────────────────────────────────────────────────────────────────────

export type SecretaryMode = 'online' | 'busy' | 'away' | 'dnd'
export type Priority = 'urgent' | 'normal' | 'low' | 'spam'

export interface IncomingMsg {
  id: string
  from: string
  content: string
  type?: string
  ts: number
}

export interface PendingMessage {
  msg: IncomingMsg
  priority: Priority
  receivedAt: number
  autoReplied: boolean
}

export interface DailySummary {
  date: string
  totalReceived: number
  urgent: number
  autoReplied: number
  pendingCount: number
  topSenders: Array<{ from: string; count: number }>
}

interface SecretaryConfig {
  mode: SecretaryMode
  trustedContacts: string[]
  blockedContacts: string[]
  customAutoReply?: string
  updatedAt: number
}

interface DayStat {
  received: number
  urgent: number
  autoReplied: number
  senders: Record<string, number>
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SECRETARY_DIR = path.join(os.homedir(), '.jackclaw', 'node')
const CONFIG_PATH   = path.join(SECRETARY_DIR, 'secretary.json')
const PENDING_PATH  = path.join(SECRETARY_DIR, 'secretary-pending.json')
const STATS_PATH    = path.join(SECRETARY_DIR, 'secretary-stats.json')

const URGENT_KEYWORDS = [
  '紧急', '急', '火急', '救命', '重要', '立刻', '马上', '尽快', '速回', '立即', '今天必须', '截止',
  'urgent', 'URGENT', 'asap', 'ASAP', 'emergency', 'critical', 'help!', 'deadline', 'due today',
]

const SPAM_KEYWORDS = [
  '广告', '推广', '优惠券', '免费领取', '限时折扣', '中奖', '赚钱', '兼职', '投资',
  'promotion', 'subscribe now', 'unsubscribe', 'click here', 'special offer',
]

const DEFAULT_CONFIG: SecretaryConfig = {
  mode: 'online',
  trustedContacts: [],
  blockedContacts: [],
  updatedAt: Date.now(),
}

// ─── AiSecretary ──────────────────────────────────────────────────────────────

export class AiSecretary {
  private config: SecretaryConfig
  private pending: PendingMessage[]
  private stats: Record<string, DayStat>
  private readonly notifyOwner: ((msg: IncomingMsg, priority: Priority) => void) | null
  private readonly sendReply: ((to: string, content: string) => Promise<void>) | null
  private readonly aiClient: AiClient | null
  private readonly ownerMemory: OwnerMemory | null

  constructor(opts?: {
    notifyOwner?: (msg: IncomingMsg, priority: Priority) => void
    sendReply?: (to: string, content: string) => Promise<void>
    aiClient?: AiClient
    ownerMemory?: OwnerMemory
  }) {
    this.config      = this.loadConfig()
    this.pending     = this.loadPending()
    this.stats       = this.loadStats()
    this.notifyOwner = opts?.notifyOwner ?? null
    this.sendReply   = opts?.sendReply ?? null
    this.aiClient    = opts?.aiClient ?? null
    this.ownerMemory = opts?.ownerMemory ?? null
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  setMode(mode: SecretaryMode): void {
    this.config.mode = mode
    this.config.updatedAt = Date.now()
    this.saveConfig()
    console.log(`[secretary] Mode → ${mode}`)
  }

  getMode(): SecretaryMode {
    return this.config.mode
  }

  setCustomAutoReply(text: string): void {
    this.config.customAutoReply = text
    this.config.updatedAt = Date.now()
    this.saveConfig()
  }

  getConfig(): Readonly<SecretaryConfig> {
    return { ...this.config }
  }

  getPending(): PendingMessage[] {
    return [...this.pending]
  }

  clearPending(): void {
    this.pending = []
    this.savePending()
  }

  async handleIncoming(msg: IncomingMsg): Promise<void> {
    const priority = this.classifyPriority(msg)
    let autoReplied = false

    switch (this.config.mode) {
      case 'online':
        // Pass through — notify owner directly
        this.notifyOwner?.(msg, priority)
        break

      case 'busy':
        if (priority === 'urgent') {
          this.notifyOwner?.(msg, priority)
        } else {
          this.enqueue(msg, priority, false)
        }
        break

      case 'away': {
        const reply = await this.generateAutoReply(msg, 'away')
        if (this.sendReply) {
          await this.sendReply(msg.from, reply).catch((err: Error) =>
            console.error('[secretary] Auto-reply failed:', err.message),
          )
          autoReplied = true
        }
        this.enqueue(msg, priority, autoReplied)
        break
      }

      case 'dnd':
        // Silent queue
        this.enqueue(msg, priority, false)
        break
    }

    this.recordStat(msg.from, priority, autoReplied)
  }

  async generateAutoReply(msg: IncomingMsg, _context: string): Promise<string> {
    // Prefer custom reply
    if (this.config.customAutoReply) {
      return this.config.customAutoReply
    }

    // AI-personalized reply via OwnerMemory context
    if (this.aiClient && this.ownerMemory) {
      try {
        const personality  = this.ownerMemory.get('personality').map((e: { content: string }) => e.content).join('；')
        const preferences  = this.ownerMemory.get('preference').map((e: { content: string }) => e.content).join('；')

        const result = await this.aiClient.call({
          systemPrompt: [
            '你是主人的 AI 秘书，正在代替主人自动回复消息。',
            `主人性格：${personality || '专业、友善'}`,
            `沟通偏好：${preferences || '简洁直接'}`,
            '请用中文生成一条 50 字以内的自动回复，语气自然有温度，代表主人本人回复。',
          ].join('\n'),
          messages: [{ role: 'user', content: `需要回复的消息（来自 ${msg.from}）：${msg.content}` }],
          maxTokens: 120,
        })
        return result.content.trim()
      } catch (err: any) {
        console.error('[secretary] AI reply failed, using template:', err.message)
      }
    }

    return '主人暂时不在，我是 AI 助手，有什么可以先帮忙？'
  }

  async summarizeUnread(messages: IncomingMsg[]): Promise<string> {
    if (messages.length === 0) return '暂无未读消息。'

    if (this.aiClient) {
      try {
        const msgList = messages
          .slice(0, 20)
          .map((m, i) => `${i + 1}. [${m.from}] ${m.content}`)
          .join('\n')

        const result = await this.aiClient.call({
          systemPrompt: '你是 AI 秘书，请用中文总结以下未读消息（100 字以内），按重要程度排序，标出紧急条目。',
          messages: [{ role: 'user', content: msgList }],
          maxTokens: 220,
        })
        return result.content.trim()
      } catch (err: any) {
        console.error('[secretary] AI summarize failed, using template:', err.message)
      }
    }

    // Fallback: structured text summary
    const urgentMsgs = messages.filter(m => this.classifyPriority(m) === 'urgent')
    const senders    = [...new Set(messages.map(m => m.from))].slice(0, 5)
    const extra      = messages.length > senders.length ? ` 等 ${messages.length} 人` : ''

    return [
      `共 ${messages.length} 条未读消息`,
      urgentMsgs.length > 0 ? `，其中 ${urgentMsgs.length} 条紧急` : '',
      `。来自：${senders.join('、')}${extra}。`,
    ].join('')
  }

  /**
   * 规则引擎优先级分类 — 不依赖 LLM，快速响应
   */
  classifyPriority(msg: IncomingMsg): Priority {
    const lower = msg.content.toLowerCase()
    const fromLower = msg.from.toLowerCase()

    // Blocked → spam
    if (this.config.blockedContacts.some(b => fromLower.includes(b.toLowerCase()))) {
      return 'spam'
    }

    // Spam keywords
    if (SPAM_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()))) {
      return 'spam'
    }

    // Urgent keywords (check both original and lowercased to catch CJK + ASCII)
    if (URGENT_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()) || msg.content.includes(kw))) {
      return 'urgent'
    }

    // Trusted contacts → normal
    if (this.config.trustedContacts.some(t => fromLower.includes(t.toLowerCase()))) {
      return 'normal'
    }

    // Unknown contacts → low
    return 'low'
  }

  getDailySummary(): DailySummary {
    const today = this.todayKey()
    const stat  = this.stats[today] ?? { received: 0, urgent: 0, autoReplied: 0, senders: {} }

    const topSenders = Object.entries(stat.senders)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([from, count]) => ({ from, count }))

    const pendingCount = this.pending.filter(p => !p.autoReplied).length

    return {
      date: today,
      totalReceived: stat.received,
      urgent: stat.urgent,
      autoReplied: stat.autoReplied,
      pendingCount,
      topSenders,
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private enqueue(msg: IncomingMsg, priority: Priority, autoReplied: boolean): void {
    this.pending.push({ msg, priority, receivedAt: Date.now(), autoReplied })
    if (this.pending.length > 500) this.pending = this.pending.slice(-500)
    this.savePending()
  }

  private recordStat(from: string, priority: Priority, autoReplied: boolean): void {
    const today = this.todayKey()
    if (!this.stats[today]) {
      this.stats[today] = { received: 0, urgent: 0, autoReplied: 0, senders: {} }
    }
    const s = this.stats[today]
    s.received++
    if (priority === 'urgent') s.urgent++
    if (autoReplied) s.autoReplied++
    s.senders[from] = (s.senders[from] ?? 0) + 1

    // Keep last 30 days
    const keys = Object.keys(this.stats).sort()
    while (keys.length > 30) delete this.stats[keys.shift()!]

    this.saveStats()
  }

  private todayKey(): string {
    return new Date().toISOString().slice(0, 10)
  }

  private ensureDir(): void {
    if (!fs.existsSync(SECRETARY_DIR)) {
      fs.mkdirSync(SECRETARY_DIR, { recursive: true, mode: 0o700 })
    }
  }

  private loadConfig(): SecretaryConfig {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }
      }
    } catch { /* ignore parse errors */ }
    return { ...DEFAULT_CONFIG }
  }

  private saveConfig(): void {
    this.ensureDir()
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), { mode: 0o600 })
  }

  private loadPending(): PendingMessage[] {
    try {
      if (fs.existsSync(PENDING_PATH)) {
        return JSON.parse(fs.readFileSync(PENDING_PATH, 'utf8'))
      }
    } catch { /* ignore */ }
    return []
  }

  private savePending(): void {
    this.ensureDir()
    fs.writeFileSync(PENDING_PATH, JSON.stringify(this.pending, null, 2), { mode: 0o600 })
  }

  private loadStats(): Record<string, DayStat> {
    try {
      if (fs.existsSync(STATS_PATH)) {
        return JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'))
      }
    } catch { /* ignore */ }
    return {}
  }

  private saveStats(): void {
    this.ensureDir()
    fs.writeFileSync(STATS_PATH, JSON.stringify(this.stats, null, 2), { mode: 0o600 })
  }
}
