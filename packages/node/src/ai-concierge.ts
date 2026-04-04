/**
 * AiConcierge — AI 代办
 *
 * 功能：
 *   - 日程协商：解析自然语言时间，与对方 Agent 协商可用时段
 *   - 任务提醒：创建/查看/取消到期提醒，定时检查触发
 *
 * 存储：~/.jackclaw/node/concierge.json
 * 通信：通过 Hub /api/social/send 发送协商消息
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID } from 'crypto'
import {
  parseNaturalTime,
  parseDuration,
} from '@jackclaw/protocol'
import type { ScheduleRequest, ScheduleResponse, Reminder, ConciergeState } from '@jackclaw/protocol'

// ─── 存储路径 ─────────────────────────────────────────────────────────────────

const STORE_DIR  = path.join(os.homedir(), '.jackclaw', 'node')
const STORE_FILE = path.join(STORE_DIR, 'concierge.json')

// ─── AiConcierge ─────────────────────────────────────────────────────────────

export class AiConcierge {
  private nodeId: string
  private hubUrl: string
  private agentHandle: string

  constructor(opts: { nodeId: string; hubUrl: string; agentHandle?: string }) {
    this.nodeId      = opts.nodeId
    this.hubUrl      = opts.hubUrl
    this.agentHandle = opts.agentHandle ?? opts.nodeId
  }

  // ─── 日程协商 ─────────────────────────────────────────────────────────────

  /**
   * 发起日程协商：
   *   1. 解析自然语言时间
   *   2. 生成候选时间列表（目标时间 + 备选）
   *   3. 通过 Hub 发送协商消息给对方 Agent
   *   4. 本地记录 pending 请求
   */
  async scheduleNegotiation(
    withAgent: string,
    request: string,
  ): Promise<{ requestId: string; proposedTimes: number[]; message: string }> {
    const toAgent = withAgent.startsWith('@') ? withAgent : `@${withAgent}`

    const ts = parseNaturalTime(request)
    if (!ts) throw new Error(`无法解析时间：${request}`)

    const duration = parseDuration(request)
    const topic = request
      .replace(/[零一二两三四五六七八九十\d]+小时/g, '')
      .replace(/[零一二两三四五六七八九十\d]+分[钟]?/g, '')
      .replace(/半小时/g, '')
      .replace(/@[\w\-_]+/g, '')
      .trim() || '会议'

    // 候选时间：目标时间 + 同日+1h + 次日同时间
    const proposedTimes = [
      ts,
      ts + 60 * 60 * 1000,
      ts + 24 * 60 * 60 * 1000,
    ]

    const requestId = randomUUID()
    const schedReq: ScheduleRequest = {
      requestId,
      fromAgent: this.agentHandle,
      toAgent,
      proposedTimes,
      duration,
      topic,
      ts: Date.now(),
    }

    const state = this._load()
    state.pendingRequests.push(schedReq)
    this._save(state)

    const content = JSON.stringify({ type: 'schedule_request', data: schedReq })
    await this._sendSocial(toAgent, content, 'schedule_request')

    const message = `[concierge] 已向 ${toAgent} 发送日程协商请求 (requestId=${requestId.slice(0,8)})\n候选时间：${proposedTimes.map(t => new Date(t).toLocaleString('zh-CN')).join(' / ')}`
    console.log(message)
    return { requestId, proposedTimes, message }
  }

  /**
   * 处理对方 Agent 发来的协商消息（来自 Hub WebSocket social 事件）。
   * - 若为 schedule_request → 自动选第一个时间回复，并创建提醒
   * - 若为 schedule_response → 记录结果，创建提醒
   */
  handleNegotiationResponse(msg: { type?: string; content: string; fromAgent?: string }): void {
    let parsed: { type: string; data: unknown }
    try {
      parsed = JSON.parse(msg.content)
    } catch {
      return
    }

    if (parsed.type === 'schedule_request') {
      const req = parsed.data as ScheduleRequest
      // 仅处理发给本节点的请求
      if (req.toAgent !== this.agentHandle && req.toAgent !== `@${this.nodeId}`) return

      const accepted = req.proposedTimes[0]
      const response: ScheduleResponse = {
        requestId: req.requestId,
        fromAgent: this.agentHandle,
        toAgent: req.fromAgent,
        acceptedTime: accepted,
        ts: Date.now(),
      }

      const content = JSON.stringify({ type: 'schedule_response', data: response })
      this._sendSocial(req.fromAgent, content, 'schedule_response').catch((err: Error) => {
        console.warn('[concierge] failed to send schedule_response:', err.message)
      })

      const topic = req.topic || '会议'
      this.createReminder(
        accepted,
        `[日程] 与 ${req.fromAgent} 的 ${topic}（${req.duration} 分钟）`,
      )
      console.log(`[concierge] 已接受 ${req.fromAgent} 的日程请求，时间：${new Date(accepted).toLocaleString('zh-CN')}`)
    }

    if (parsed.type === 'schedule_response') {
      const resp = parsed.data as ScheduleResponse
      const state = this._load()
      const idx = state.pendingRequests.findIndex(r => r.requestId === resp.requestId)
      if (idx === -1) return

      const req = state.pendingRequests[idx]
      state.pendingRequests.splice(idx, 1)
      state.completedRequests.push({ ...req, response: resp })
      this._save(state)

      if (resp.declined) {
        console.log(`[concierge] ${resp.fromAgent} 拒绝了日程请求 ${resp.requestId.slice(0,8)}：${resp.reason ?? ''}`)
        return
      }

      const accepted = resp.acceptedTime ?? resp.counterProposal?.[0]
      if (accepted) {
        this.createReminder(
          accepted,
          `[日程] 与 ${resp.fromAgent} 的 ${req.topic}（${req.duration} 分钟）`,
        )
        console.log(`[concierge] 日程已确认：${new Date(accepted).toLocaleString('zh-CN')} 与 ${resp.fromAgent}`)
      }
    }
  }

  // ─── 提醒管理 ─────────────────────────────────────────────────────────────

  createReminder(time: number, message: string): Reminder {
    const reminder: Reminder = {
      id: randomUUID(),
      nodeId: this.nodeId,
      time,
      message,
      status: 'pending',
      createdAt: Date.now(),
    }
    const state = this._load()
    state.reminders.push(reminder)
    this._save(state)
    console.log(`[concierge] 提醒已创建：${new Date(time).toLocaleString('zh-CN')} — ${message}`)
    return reminder
  }

  listReminders(): Reminder[] {
    return this._load().reminders.filter(r => r.status !== 'cancelled')
  }

  cancelReminder(id: string): boolean {
    const state = this._load()
    const r = state.reminders.find(x => x.id === id || x.id.startsWith(id))
    if (!r) return false
    r.status = 'cancelled'
    this._save(state)
    return true
  }

  /**
   * 检查到期提醒（每分钟调用一次），触发并标记已触发。
   */
  checkReminders(): void {
    const now = Date.now()
    const state = this._load()
    let changed = false

    for (const r of state.reminders) {
      if (r.status === 'pending' && r.time <= now) {
        r.status = 'triggered'
        changed = true
        console.log(`\n[concierge] ⏰ 提醒：${r.message}\n`)
      }
    }

    if (changed) this._save(state)
  }

  // ─── 私有辅助 ─────────────────────────────────────────────────────────────

  private async _sendSocial(toAgent: string, content: string, type: string): Promise<void> {
    const body = JSON.stringify({
      fromHuman: 'concierge',
      fromAgent: this.agentHandle,
      toAgent,
      content,
      type,
    })

    const res = await fetch(`${this.hubUrl}/api/social/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Hub send failed: ${res.status} ${text}`)
    }
  }

  private _load(): ConciergeState {
    if (!fs.existsSync(STORE_FILE)) {
      return { reminders: [], pendingRequests: [], completedRequests: [] }
    }
    try {
      return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')) as ConciergeState
    } catch {
      return { reminders: [], pendingRequests: [], completedRequests: [] }
    }
  }

  private _save(state: ConciergeState): void {
    fs.mkdirSync(STORE_DIR, { recursive: true })
    fs.writeFileSync(STORE_FILE, JSON.stringify(state, null, 2))
  }
}

// ─── 单例 ──────────────────────────────────────────────────────────────────

let _instance: AiConcierge | null = null

export function createConcierge(opts: {
  nodeId: string
  hubUrl: string
  agentHandle?: string
}): AiConcierge {
  _instance = new AiConcierge(opts)
  return _instance
}

export function getConcierge(): AiConcierge | null {
  return _instance
}
