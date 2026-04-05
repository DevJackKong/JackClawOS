/**
 * commands.ts — JackClaw plugin command handlers.
 *
 * Registers slash-commands and natural-language keyword handlers so users can
 * query Hub state from any OpenClaw channel (Feishu, WeChat, Telegram, etc.).
 *
 * Supported commands:
 *   /jackclaw status   → node online status
 *   /jackclaw report   → today's summary
 *   /jackclaw help     → usage help
 *
 * Natural-language triggers (handled via inbound_claim hook in plugin.ts):
 *   「团队汇报」「日报」「汇报」 → today's summary
 *   「节点状态」「在线情况」     → node status
 */

import type {
  OpenClawPluginCommandDefinition,
  PluginCommandContext,
} from 'openclaw/plugin-sdk/plugin-entry'
import {
  fetchChatInbox,
  fetchChatThreads,
  fetchContactSearch,
  fetchNodes,
  fetchOnlineUsers,
  fetchSummary,
  formatChatInbox,
  formatChatThreads,
  formatContactSearch,
  formatNodeStatus,
  formatOnlineUsers,
  formatSummary,
  hubHealthCheck,
  sendChatMessage,
  updateChatProfile,
  createChatGroup,
  fetchChatGroups,
  sendGroupMessage,
  formatChatGroups,
  fetchMyProfile,
  updateMyProfile,
} from './bridge.js'
import { getClawChatAuth } from './clawchat-auth.js'

/** Minimal reply payload: { text } */
export type CommandReply = { text: string }

function replyText(text: string): CommandReply {
  return { text }
}

async function handleStatus(_ctx: PluginCommandContext): Promise<CommandReply> {
  const alive = await hubHealthCheck()
  if (!alive) {
    return replyText('⚠️ JackClaw Hub 离线，无法获取节点状态。\n请检查 Hub 服务是否运行（默认端口 3100）。')
  }
  const nodes = await fetchNodes()
  return replyText(formatNodeStatus(nodes))
}

async function handleReport(_ctx: PluginCommandContext): Promise<CommandReply> {
  const alive = await hubHealthCheck()
  if (!alive) {
    return replyText('⚠️ JackClaw Hub 离线，无法获取汇报数据。\n请检查 Hub 服务是否运行（默认端口 3100）。')
  }
  const summary = await fetchSummary()
  return replyText(formatSummary(summary))
}

function handleHelp(_ctx: PluginCommandContext): CommandReply {
  return replyText(
    '**JackClaw 插件指令**\n\n' +
    '/jackclaw status          — 查看所有节点在线情况\n' +
    '/jackclaw report          — 查看今日团队汇报摘要\n' +
    '/jackclaw profile         — 查看 ClawChat 账号信息\n' +
    '/jackclaw profile --name "名字" — 修改显示名\n' +
    '/jackclaw help            — 显示此帮助\n\n' +
    '**自然语言触发词**\n' +
    '「团队汇报」「日报」→ 汇报摘要\n' +
    '「节点状态」「在线情况」→ 节点状态',
  )
}

/** Main dispatcher for /jackclaw <subcommand> */
async function jackclawCommandHandler(ctx: PluginCommandContext): Promise<CommandReply> {
  const raw = (ctx.args ?? '').trim()
  const sub = raw.toLowerCase().split(/\s+/)[0] ?? ''

  switch (sub) {
    case 'status':
      return handleStatus(ctx)
    case 'report':
    case 'summary':
      return handleReport(ctx)
    case 'profile':
      return handleProfile(raw)
    case 'help':
    case '':
      return handleHelp(ctx)
    default:
      return replyText(
        `未知子命令 "${sub}"。\n` +
        '可用：status | report | profile | help\n' +
        '输入 /jackclaw help 查看帮助。',
      )
  }
}

async function handleProfile(rawArgs: string): Promise<CommandReply> {
  const auth = await getClawChatAuth()
  if (!auth) {
    return replyText('⚠️ 未找到 ClawChat 账号信息。请重启插件以自动注册。')
  }

  // Parse optional --name "..."
  const nameMatch = rawArgs.match(/--name\s+"([^"]+)"/) ?? rawArgs.match(/--name\s+(\S+)/)
  if (nameMatch?.[1]) {
    const newName = nameMatch[1]
    try {
      await updateMyProfile(auth.token, { displayName: newName })
      return replyText(`✅ 显示名已更新为「${newName}」`)
    } catch (err) {
      return replyText(`❌ 更新失败：${(err as Error).message}`)
    }
  }

  // Show current profile from Hub
  try {
    const profile = await fetchMyProfile(auth.token) as Record<string, unknown>
    const displayName = (profile['displayName'] ?? profile['handle'] ?? auth.handle) as string
    const bio = profile['bio'] ? `\nBio: ${profile['bio'] as string}` : ''
    return replyText(
      `🦞 ClawChat 账号信息\n\n` +
      `Handle: @${auth.handle}\n` +
      `显示名: ${displayName}` +
      bio + `\n` +
      `Hub: ${auth.hubUrl}\n\n` +
      `修改昵称：/jackclaw profile --name "你的名字"`,
    )
  } catch (err) {
    return replyText(`❌ 读取账号信息失败：${(err as Error).message}`)
  }
}

/**
 * Persists across invocations within the same plugin session.
 * Set via `/chat to @handle`; used when input has no known subcommand.
 */
let lastChatTarget = ""

/** /chat <subcommand> [args] */
async function chatCommandHandler(ctx: PluginCommandContext): Promise<CommandReply> {
  const raw = (ctx.args ?? '').trim()
  const tokens = raw.split(/\s+/)
  const first = tokens[0] ?? ''

  // @syntax: /chat @alice 你好 → /chat send @alice 你好
  if (first.startsWith('@')) {
    const toHandle = first.slice(1)
    const content = tokens.slice(1).join(' ')
    if (!content) return replyText('请提供消息内容。\n用法：/chat @handle 消息内容')
    const fromNodeId = process.env['JACKCLAW_NODE_ID'] ?? 'openclaw-user'
    try {
      const result = await sendChatMessage(fromNodeId, toHandle, content)
      return replyText(`✅ 消息已发送给 @${toHandle}\n消息 ID：${result.messageId}`)
    } catch (err) {
      return replyText(`❌ 发送失败：${(err as Error).message}`)
    }
  }

  const [sub, ...rest] = tokens

  switch ((sub ?? '').toLowerCase()) {
    case 'to': {
      const handleArg = rest[0] ?? ''
      if (!handleArg.startsWith('@')) {
        return replyText('用法：/chat to @handle\n示例：/chat to @bob')
      }
      lastChatTarget = handleArg.slice(1)
      return replyText(`✅ 默认聊天对象已设为 @${lastChatTarget}\n后续直接 /chat 消息 即可发送给 TA。`)
    }
    case 'list': {
      try {
        const users = await fetchOnlineUsers()
        return replyText(formatOnlineUsers(users))
      } catch (err) {
        return replyText(`❌ 获取在线用户失败：${(err as Error).message}`)
      }
    }

    case 'search': {
      const keyword = rest.join(' ').trim()
      if (!keyword) {
        return replyText('用法：/chat search <关键词>\n示例：/chat search alice')
      }
      try {
        const contacts = await fetchContactSearch(keyword)
        return replyText(formatContactSearch(contacts, keyword))
      } catch (err) {
        return replyText(`❌ 搜索失败：${(err as Error).message}`)
      }
    }

    case 'send': {
      // /chat send @handle message...  OR  /chat send message (uses lastChatTarget)
      const handleMatch = rest[0]?.match(/^@(.+)/)
      let toNodeId: string
      let content: string
      if (handleMatch?.[1]) {
        toNodeId = handleMatch[1]
        content = rest.slice(1).join(' ')
      } else if (lastChatTarget) {
        toNodeId = lastChatTarget
        content = rest.join(' ')
      } else {
        return replyText('用法：/chat send @handle 消息内容\n示例：/chat send @alice 你好！')
      }
      if (!content) {
        return replyText('请提供消息内容。\n用法：/chat send @handle 消息内容')
      }
      const fromNodeId = process.env['JACKCLAW_NODE_ID'] ?? 'openclaw-user'
      try {
        const result = await sendChatMessage(fromNodeId, toNodeId, content)
        return replyText(`✅ 消息已发送给 @${toNodeId}\n消息 ID：${result.messageId}`)
      } catch (err) {
        return replyText(`❌ 发送失败：${(err as Error).message}`)
      }
    }

    case 'inbox': {
      const nodeId = process.env['JACKCLAW_NODE_ID'] ?? (rest[0] ?? '')
      if (!nodeId) {
        return replyText('请设置 JACKCLAW_NODE_ID 环境变量，或指定节点 ID：/chat inbox <nodeId>')
      }
      try {
        const result = await fetchChatInbox(nodeId)
        return replyText(formatChatInbox(result))
      } catch (err) {
        return replyText(`❌ 获取收件箱失败：${(err as Error).message}`)
      }
    }

    case 'threads': {
      const nodeId = process.env['JACKCLAW_NODE_ID'] ?? (rest[0] ?? '')
      if (!nodeId) {
        return replyText('请设置 JACKCLAW_NODE_ID 环境变量，或指定节点 ID：/chat threads <nodeId>')
      }
      try {
        const result = await fetchChatThreads(nodeId)
        return replyText(formatChatThreads(result))
      } catch (err) {
        return replyText(`❌ 获取会话列表失败：${(err as Error).message}`)
      }
    }

    case 'reply': {
      const threadId = rest[0]
      const content = rest.slice(1).join(' ')
      if (!threadId || !content) {
        return replyText('用法：/chat reply <threadId> 消息内容\n示例：/chat reply thread-123 收到，稍后处理。')
      }
      const fromNodeId = process.env['JACKCLAW_NODE_ID'] ?? 'openclaw-user'
      // Use threadId prefix as recipient placeholder; Hub resolves delivery from thread context
      try {
        const result = await sendChatMessage(fromNodeId, threadId, content, threadId)
        return replyText(`✅ 已回复会话 ${threadId}\n消息 ID：${result.messageId}`)
      } catch (err) {
        return replyText(`❌ 回复失败：${(err as Error).message}`)
      }
    }

    case 'group': {
      const [groupSub, ...groupArgs] = rest
      switch ((groupSub ?? '').toLowerCase()) {
        case 'create': {
          // group create 群名 @user1 @user2 ...
          const namePart = groupArgs[0]
          if (!namePart) {
            return replyText('用法：/chat group create <群名> @user1 @user2\n示例：/chat group create 项目组 @alice @bob')
          }
          const members = groupArgs.slice(1).map(m => m.replace(/^@/, ''))
          const createdBy = process.env['JACKCLAW_NODE_ID'] ?? 'openclaw-user'
          try {
            const result = await createChatGroup(namePart, members, createdBy)
            const g = result.group ?? result
            return replyText(`✅ 群组「${namePart}」已创建\n群组 ID：${g.groupId ?? '—'}\n成员：${members.length > 0 ? members.join(', ') : '（仅你）'}`)
          } catch (err) {
            return replyText(`❌ 创建群组失败：${(err as Error).message}`)
          }
        }

        case 'list': {
          const nodeId = process.env['JACKCLAW_NODE_ID'] ?? (groupArgs[0] ?? '')
          if (!nodeId) {
            return replyText('请设置 JACKCLAW_NODE_ID 环境变量，或指定节点 ID：/chat group list <nodeId>')
          }
          try {
            const result = await fetchChatGroups(nodeId)
            return replyText(formatChatGroups(result))
          } catch (err) {
            return replyText(`❌ 获取群组列表失败：${(err as Error).message}`)
          }
        }

        case 'send': {
          // group send groupId 消息...
          const groupId = groupArgs[0]
          const content = groupArgs.slice(1).join(' ')
          if (!groupId || !content) {
            return replyText('用法：/chat group send <groupId> 消息内容\n示例：/chat group send grp-123 大家好！')
          }
          const from = process.env['JACKCLAW_NODE_ID'] ?? 'openclaw-user'
          try {
            const result = await sendChatMessage(from, groupId, content)
            return replyText(`✅ 消息已发送至群组 ${groupId}\n消息 ID：${result.messageId}`)
          } catch (err) {
            return replyText(`❌ 发送群消息失败：${(err as Error).message}`)
          }
        }

        default:
          return replyText(
            '**群组指令**\n\n' +
            '/chat group create <群名> @user1 @user2 — 创建群组\n' +
            '/chat group list                        — 查看我的群组\n' +
            '/chat group send <groupId> 消息         — 发送群消息',
          )
      }
    }

    case 'help':
    case '':
    case undefined:
      return replyText(
        '**ClawChat 指令**\n\n' +
        '/chat @handle 消息          — 直接发送消息（快捷方式）\n' +
        '/chat to @handle            — 设置默认聊天对象，之后直接 /chat 消息 即可\n' +
        '/chat list                  — 查看当前在线用户\n' +
        '/chat search <关键词>       — 搜索用户（支持 handle 和显示名）\n' +
        '/chat send @handle 消息     — 发送消息给指定节点\n' +
        '/chat inbox                 — 查看未读消息\n' +
        '/chat threads               — 查看会话列表\n' +
        '/chat reply <threadId> 消息 — 回复某个会话\n' +
        '/chat group create/list/send — 群组功能\n' +
        '/chat help                  — 显示此帮助',
      )

    default: {
      // Plain text with no known subcommand → send to lastChatTarget
      if (raw && lastChatTarget) {
        const fromNodeId = process.env['JACKCLAW_NODE_ID'] ?? 'openclaw-user'
        try {
          const result = await sendChatMessage(fromNodeId, lastChatTarget, raw)
          return replyText(`✅ 消息已发送给 @${lastChatTarget}\n消息 ID：${result.messageId}`)
        } catch (err) {
          return replyText(`❌ 发送失败：${(err as Error).message}`)
        }
      }
      return replyText(
        `未知子命令 "${sub}"。\n` +
        '可用：list | search | send | inbox | threads | reply | group | to | help\n' +
        '发送快捷方式：/chat @handle 消息  或先 /chat to @handle 设定默认对象',
      )
    }
  }
}

export const JACKCLAW_COMMANDS: OpenClawPluginCommandDefinition[] = [
  {
    name: 'jackclaw',
    description: 'JackClaw — 查询团队汇报和节点状态',
    acceptsArgs: true,
    requireAuth: true,
    handler: jackclawCommandHandler,
  },
  {
    name: 'chat',
    description: 'ClawChat — 发送和接收 JackClaw 节点间消息',
    acceptsArgs: true,
    requireAuth: true,
    handler: chatCommandHandler,
  },
]

/** Natural-language keyword matcher */
export function matchNaturalLanguage(content: string): 'report' | 'status' | null {
  const c = content.trim()
  if (/团队汇报|日报|汇报摘要|今日汇报/.test(c)) return 'report'
  if (/节点状态|在线情况|节点在线/.test(c)) return 'status'
  return null
}

export { handleReport, handleStatus }
