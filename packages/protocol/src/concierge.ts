/**
 * JackClaw Protocol — Concierge Types + 自然语言时间解析工具
 * AI 代办：日程协商 + 任务提醒
 */

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

/** 发起方提出的日程协商请求 */
export interface ScheduleRequest {
  requestId: string
  fromAgent: string
  toAgent: string
  proposedTimes: number[]    // Unix ms 时间戳列表
  duration: number           // 会议时长（分钟）
  topic: string
  ts: number
}

/** 接收方返回的协商回复 */
export interface ScheduleResponse {
  requestId: string
  fromAgent: string
  toAgent: string
  acceptedTime?: number      // 接受的时间（Unix ms）
  counterProposal?: number[] // 反提议时间列表
  declined?: boolean
  reason?: string
  ts: number
}

/** 本地提醒条目 */
export interface Reminder {
  id: string
  nodeId: string
  time: number               // 触发时间（Unix ms）
  message: string
  repeat?: string            // cron 表达式，可选
  status: 'pending' | 'triggered' | 'cancelled'
  createdAt: number
}

/** 并发代办存储结构 */
export interface ConciergeState {
  reminders: Reminder[]
  pendingRequests: ScheduleRequest[]
  completedRequests: Array<ScheduleRequest & { response?: ScheduleResponse }>
}

// ─── 自然语言时间解析（纯规则，不依赖 LLM） ───────────────────────────────────

/** 将中文数字转为阿拉伯数字 */
function cnDigit(s: string): number {
  const MAP: Record<string, number> = {
    零:0, 一:1, 二:2, 两:2, 三:3, 四:4, 五:5,
    六:6, 七:7, 八:8, 九:9, 十:10,
  }
  if (/^\d+$/.test(s)) return parseInt(s, 10)
  if (s.startsWith('十')) return 10 + (MAP[s[1]] ?? 0)
  if (s.endsWith('十'))   return (MAP[s[0]] ?? 1) * 10
  return MAP[s] ?? NaN
}

/** 解析 "X点" / "X时" / "X点半" 中的小时和分钟 */
function parseHourMin(text: string): { hour: number; min: number } | null {
  const m = text.match(/([零一二两三四五六七八九十\d]+)[点时]([半刻]|\d+分?)?/)
  if (!m) return null
  const hour = cnDigit(m[1])
  if (isNaN(hour)) return null
  let min = 0
  if (m[2] === '半') min = 30
  else if (m[2] === '刻') min = 15
  else if (m[2]) min = parseInt(m[2], 10) || 0
  return { hour, min }
}

/** 解析时间段关键词为默认小时 */
function periodHour(text: string): number {
  if (/早上|早晨|上午/.test(text)) return 9
  if (/中午/.test(text))           return 12
  if (/下午/.test(text))           return 14
  if (/傍晚/.test(text))           return 17
  if (/晚上|夜里/.test(text))      return 19
  return 9
}

/** 中文星期 → Date.getDay() 值（0=周日） */
const WEEKDAY_MAP: Record<string, number> = {
  日:0, 天:0, 一:1, 二:2, 三:3, 四:4, 五:5, 六:6,
}

/** 将时间段和具体点钟信息写入 Date 对象 */
function applyPeriodAndHour(d: Date, text: string): void {
  const hm = parseHourMin(text)
  if (hm) {
    let { hour, min } = hm
    if (/下午|晚上|傍晚/.test(text) && hour < 12) hour += 12
    d.setHours(hour, min, 0, 0)
  } else {
    d.setHours(periodHour(text), 0, 0, 0)
  }
}

/**
 * 将自然语言时间描述解析为 Unix ms 时间戳。
 *
 * 支持形式（示例）：
 *   今天下午三点    明天早上9点    后天晚上8点半
 *   下周三下午      下周一上午10点  本周五
 *   3天后           2小时后
 */
export function parseNaturalTime(text: string, base: Date = new Date()): number | null {
  const t = text.trim()
  const now = new Date(base)
  now.setSeconds(0, 0)

  // "X 小时后"
  const hoursLater = t.match(/([零一二两三四五六七八九十\d]+)\s*小时后/)
  if (hoursLater) {
    const h = cnDigit(hoursLater[1])
    if (!isNaN(h)) {
      const d = new Date(now)
      d.setHours(d.getHours() + h)
      return d.getTime()
    }
  }

  // "X 天后" / "X 日后"
  const daysLater = t.match(/([零一二两三四五六七八九十\d]+)\s*[天日]后/)
  if (daysLater) {
    const days = cnDigit(daysLater[1])
    if (!isNaN(days)) {
      const d = new Date(now)
      d.setDate(d.getDate() + days)
      applyPeriodAndHour(d, t)
      return d.getTime()
    }
  }

  let target: Date | null = null

  if (/今天|今日/.test(t)) {
    target = new Date(now)
  } else if (/明天|明日/.test(t)) {
    target = new Date(now)
    target.setDate(target.getDate() + 1)
  } else if (/后天/.test(t)) {
    target = new Date(now)
    target.setDate(target.getDate() + 2)
  } else {
    // "下周X" / "本周X" / "这周X" / "周X" / "星期X"
    const weekMatch = t.match(/(?:下周|下星期|下礼拜|本周|这周|周|星期)([一二三四五六日天])/)
    if (weekMatch) {
      const targetDay = WEEKDAY_MAP[weekMatch[1]]
      const isNext = /下周|下星期|下礼拜/.test(t)
      target = new Date(now)
      const curDay = target.getDay()
      let diff = targetDay - curDay
      if (isNext) {
        diff = diff <= 0 ? diff + 7 : diff + 7
      } else {
        if (diff <= 0) diff += 7
      }
      target.setDate(target.getDate() + diff)
    }
  }

  if (!target) return null

  applyPeriodAndHour(target, t)
  return target.getTime()
}

/**
 * 从自然语言文本中解析时长（分钟）。
 * 支持：一小时 / 1小时 / 两小时 / 半小时 / 30分 / 1.5小时
 */
export function parseDuration(text: string): number {
  const floatHour = text.match(/(\d+\.\d+)\s*小时/)
  if (floatHour) return Math.round(parseFloat(floatHour[1]) * 60)

  const hourMatch = text.match(/([零一二两三四五六七八九十\d]+)\s*小时/)
  if (hourMatch) {
    const h = cnDigit(hourMatch[1])
    if (!isNaN(h)) return h * 60
  }

  if (/半小时/.test(text)) return 30

  const minMatch = text.match(/([零一二两三四五六七八九十\d]+)\s*分(?:钟)?/)
  if (minMatch) {
    const m = cnDigit(minMatch[1])
    if (!isNaN(m)) return m
  }

  return 60 // 默认 60 分钟
}
