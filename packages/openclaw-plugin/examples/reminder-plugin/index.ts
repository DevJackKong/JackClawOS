import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry'
import type {
  OpenClawPluginCommandDefinition,
  PluginCommandContext,
} from 'openclaw/plugin-sdk/plugin-entry'

function reply(text: string) {
  return { text }
}

function parseDuration(input: string): number | null {
  const match = input.trim().match(/^(\d+)\s*([smhd])$/i)
  if (!match) return null

  const value = Number(match[1])
  const unit = match[2].toLowerCase()
  const multipliers: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  }

  return value * multipliers[unit]
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()

function makeReminderId() {
  return `reminder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

async function handleRemind(ctx: PluginCommandContext) {
  const raw = (ctx.args ?? '').trim()
  const match = raw.match(/^(\S+)\s+([\s\S]+)$/)

  if (!match) {
    return reply('用法：/remind 30m 开会')
  }

  const durationText = match[1]
  const content = match[2].trim()
  const delay = parseDuration(durationText)

  if (!delay) {
    return reply('时间格式不支持。示例：/remind 30m 开会，支持 s/m/h/d')
  }

  const reminderId = makeReminderId()
  const logger = (ctx as PluginCommandContext & { logger?: { info: (msg: string) => void } }).logger

  const timer = setTimeout(() => {
    const line = `[reminder-plugin] ⏰ ${content}`
    if (logger) {
      logger.info(line)
    } else {
      console.log(line)
    }
    timers.delete(reminderId)
  }, delay)

  timers.set(reminderId, timer)

  return reply(`⏰ 已设置提醒\nID：${reminderId}\n时间：${durationText}\n内容：${content}`)
}

const remindCommand: OpenClawPluginCommandDefinition = {
  name: 'remind',
  description: '设置一个 demo 提醒。用法：/remind 30m 开会',
  acceptsArgs: true,
  requireAuth: false,
  handler: handleRemind,
}

export default definePluginEntry({
  id: 'example-reminder-plugin',
  name: 'Reminder Plugin Example',
  description: '示例提醒插件：注册 /remind，用 setTimeout 做 demo 级提醒。',
  register(api) {
    api.registerCommand(remindCommand)
    api.logger.info('[example-reminder-plugin] registered /remind')
  },
})
