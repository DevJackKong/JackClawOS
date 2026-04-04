/**
 * CLI commands — AI 代办（日程协商 + 任务提醒）
 *
 * jackclaw schedule <toAgent> [request]  — 发起日程协商
 * jackclaw remind <message|cancel <id>>  — 创建或取消提醒
 * jackclaw reminders                      — 查看提醒列表
 */

import { Command } from 'commander'
import chalk from 'chalk'
import axios from 'axios'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID } from 'crypto'
import { parseNaturalTime, parseDuration } from '@jackclaw/protocol'
import type { ConciergeState, Reminder } from '@jackclaw/protocol'
import { loadConfig } from '../config-utils.js'

// ─── 存储（与 AiConcierge 共享同一文件）──────────────────────────────────────

const STORE_FILE = path.join(os.homedir(), '.jackclaw', 'node', 'concierge.json')

function loadState(): ConciergeState {
  if (!fs.existsSync(STORE_FILE)) {
    return { reminders: [], pendingRequests: [], completedRequests: [] }
  }
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')) as ConciergeState
  } catch {
    return { reminders: [], pendingRequests: [], completedRequests: [] }
  }
}

function saveState(state: ConciergeState): void {
  const dir = path.dirname(STORE_FILE)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(STORE_FILE, JSON.stringify(state, null, 2))
}

function getHub(opts: { hub?: string }): string {
  const cfg = loadConfig()
  return (opts.hub ?? cfg?.hubUrl ?? 'http://localhost:3100').replace(/\/$/, '')
}

function getHandle(opts: { handle?: string; from?: string }): string {
  const cfg = loadConfig()
  return (opts.handle ?? opts.from ?? (cfg as any)?.agentHandle ?? (cfg as any)?.handle ?? '')
}

// ─── schedule ────────────────────────────────────────────────────────────────

export function registerSchedule(program: Command): void {
  program
    .command('schedule <toAgent> [request...]')
    .description('发起日程协商（例：jackclaw schedule @bob 下周三下午聊一小时）')
    .option('--hub <url>', 'Hub 地址')
    .option('--from <handle>', '你的 Agent handle')
    .action(async (toAgent: string, requestParts: string[], opts: { hub?: string; from?: string }) => {
      const hub       = getHub(opts)
      const fromAgent = getHandle(opts)
      const request   = requestParts.join(' ')

      if (!fromAgent) {
        console.error(chalk.red('[concierge] --from <handle> 必填（或在 config 设置 agentHandle）'))
        process.exit(1)
      }

      if (!request) {
        console.error(chalk.red('[concierge] 请提供协商内容，例：下周三下午聊一小时'))
        process.exit(1)
      }

      const ts = parseNaturalTime(request)
      if (!ts) {
        console.error(chalk.red(`[concierge] 无法解析时间："${request}"\n示例：下周三下午 / 明天早上9点 / 后天14:00`))
        process.exit(1)
      }

      const duration    = parseDuration(request)
      const normalAgent = toAgent.startsWith('@') ? toAgent : `@${toAgent}`
      const proposedTimes = [ts, ts + 60 * 60 * 1000, ts + 24 * 60 * 60 * 1000]
      const requestId   = randomUUID()
      const topic = request
        .replace(/[零一二两三四五六七八九十\d]+小时/g, '')
        .replace(/[零一二两三四五六七八九十\d]+分[钟]?/g, '')
        .replace(/半小时/g, '')
        .replace(/@[\w\-_]+/g, '')
        .trim() || '会议'

      const state = loadState()
      state.pendingRequests.push({
        requestId,
        fromAgent,
        toAgent: normalAgent,
        proposedTimes,
        duration,
        topic,
        ts: Date.now(),
      })
      saveState(state)

      const content = JSON.stringify({
        type: 'schedule_request',
        data: { requestId, fromAgent, toAgent: normalAgent, proposedTimes, duration, topic, ts: Date.now() },
      })

      try {
        const res = await axios.post(`${hub}/api/social/send`, {
          fromHuman: 'concierge',
          fromAgent,
          toAgent: normalAgent,
          content,
          type: 'schedule_request',
        })
        console.log(chalk.green(`[concierge] 日程协商已发送 ✓  requestId=${requestId.slice(0, 8)}`))
        console.log(chalk.gray(`  目标：${normalAgent}  话题：${topic}（${duration} 分钟）`))
        console.log(chalk.gray(`  候选时间：`))
        proposedTimes.forEach(t => console.log(chalk.gray(`    ${new Date(t).toLocaleString('zh-CN')}`)))
        if (res.data?.messageId) console.log(chalk.gray(`  messageId=${res.data.messageId}`))
      } catch (err: any) {
        const msg = err.response?.data?.error ?? err.message
        console.error(chalk.red(`[concierge] 发送失败：${msg}`))
        process.exit(1)
      }
    })
}

// ─── remind ──────────────────────────────────────────────────────────────────

export function registerRemind(program: Command): void {
  program
    .command('remind <args...>')
    .description('创建或取消提醒（例：remind 明天9点开会 / remind cancel <id>）')
    .action((args: string[]) => {
      // "remind cancel <id>"
      if (args[0] === 'cancel') {
        const id = args[1]
        if (!id) {
          console.error(chalk.red('[concierge] 用法：jackclaw remind cancel <id>'))
          process.exit(1)
        }
        const state = loadState()
        const r = state.reminders.find(x => x.id === id || x.id.startsWith(id))
        if (!r) {
          console.error(chalk.red(`[concierge] 未找到提醒：${id}`))
          process.exit(1)
        }
        r.status = 'cancelled'
        saveState(state)
        console.log(chalk.green(`[concierge] 提醒已取消：${r.message}`))
        return
      }

      const text = args.join(' ')
      const ts = parseNaturalTime(text)
      if (!ts) {
        console.error(chalk.red(`[concierge] 无法解析时间："${text}"\n示例：明天早上9点 / 下周一下午3点 / 2小时后`))
        process.exit(1)
      }

      // 提取消息内容（去掉时间词）
      const message = text
        .replace(/(?:下周|本周|这周|周|星期)[一二三四五六日天]/g, '')
        .replace(/(?:今天|明天|后天|今日|明日)/g, '')
        .replace(/[零一二两三四五六七八九十\d]+小时/g, '')
        .replace(/[零一二两三四五六七八九十\d]+分[钟]?/g, '')
        .replace(/半小时/g, '')
        .replace(/[零一二两三四五六七八九十\d]+[点时][半刻]?/g, '')
        .replace(/早上|早晨|上午|中午|下午|傍晚|晚上/g, '')
        .replace(/提醒(?:我|他|你)?/g, '')
        .replace(/\s+/g, ' ')
        .trim() || text

      const cfg = loadConfig()
      const nodeId = (cfg as any)?.nodeId ?? 'cli'

      const reminder: Reminder = {
        id: randomUUID(),
        nodeId,
        time: ts,
        message,
        status: 'pending',
        createdAt: Date.now(),
      }

      const state = loadState()
      state.reminders.push(reminder)
      saveState(state)

      console.log(chalk.green(`[concierge] 提醒已创建 ✓`))
      console.log(chalk.gray(`  ID：${reminder.id.slice(0, 8)}`))
      console.log(chalk.gray(`  时间：${new Date(ts).toLocaleString('zh-CN')}`))
      console.log(chalk.gray(`  内容：${message}`))
    })
}

// ─── reminders ───────────────────────────────────────────────────────────────

export function registerReminders(program: Command): void {
  program
    .command('reminders')
    .description('查看提醒列表')
    .option('--all', '包含已触发/已取消的提醒')
    .action((opts: { all?: boolean }) => {
      const state = loadState()
      const list = opts.all
        ? state.reminders
        : state.reminders.filter(r => r.status === 'pending')

      const statusLabel: Record<string, string> = {
        pending:   chalk.yellow('待触发'),
        triggered: chalk.green('已触发'),
        cancelled: chalk.gray('已取消'),
      }

      if (list.length === 0 && state.pendingRequests.length === 0) {
        console.log(chalk.gray('[concierge] 暂无' + (opts.all ? '' : '待触发的') + '提醒'))
        return
      }

      if (list.length > 0) {
        console.log(chalk.bold(`[concierge] 提醒列表（${list.length} 条）：`))
        for (const r of list.sort((a, b) => a.time - b.time)) {
          const status = statusLabel[r.status] ?? r.status
          const time   = chalk.cyan(new Date(r.time).toLocaleString('zh-CN'))
          const id     = chalk.gray(`(${r.id.slice(0, 8)})`)
          console.log(`  ${status}  ${time}  ${r.message}  ${id}`)
        }
      }

      const pending = state.pendingRequests
      if (pending.length > 0) {
        console.log(chalk.bold(`\n[concierge] 待确认日程（${pending.length} 条）：`))
        for (const req of pending) {
          const time = chalk.cyan(new Date(req.proposedTimes[0]).toLocaleString('zh-CN'))
          const id   = chalk.gray(`(${req.requestId.slice(0, 8)})`)
          console.log(`  ${chalk.yellow('待回复')}  ${time}  与 ${req.toAgent} 的 ${req.topic}  ${id}`)
        }
      }
    })
}
