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
} from './bridge.js'

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
    '/jackclaw status  — 查看所有节点在线情况\n' +
    '/jackclaw report  — 查看今日团队汇报摘要\n' +
    '/jackclaw help    — 显示此帮助\n\n' +
    '**自然语言触发词**\n' +
    '「团队汇报」「日报」→ 汇报摘要\n' +
    '「节点状态」「在线情况」→ 节点状态',
  )
}

/** Main dispatcher for /jackclaw <subcommand> */
async function jackclawCommandHandler(ctx: PluginCommandContext): Promise<CommandReply> {
  const sub = (ctx.args ?? '').trim().toLowerCase()

  switch (sub) {
    case 'status':
      return handleStatus(ctx)
    case 'report':
    case 'summary':
      return handleReport(ctx)
    case 'help':
    case '':
      return handleHelp(ctx)
    default:
      return replyText(
        `未知子命令 "${sub}"。\n` +
        '可用：status | report | help\n' +
        '输入 /jackclaw help 查看帮助。',
      )
  }
}

/** /chat <subcommand> [args] */
async function chatCommandHandler(ctx: PluginCommandContext): Promise<CommandReply> {
  const raw = (ctx.args ?? '').trim()
  const [sub, ...rest] = raw.split(/\s+/)

  switch ((sub ?? '').toLowerCase()) {
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
      // /chat send @handle message...
      const handleMatch = rest[0]?.match(/^@(.+)/)
      if (!handleMatch?.[1]) {
        return replyText('用法：/chat send @handle 消息内容\n示例：/chat send @alice 你好！')
      }
      const toNodeId = handleMatch[1]
      const content = rest.slice(1).join(' ')
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
      // /chat reply <threadId> message...
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

    case 'help':
    case '':
    case undefined:
      return replyText(
        '**ClawChat 指令**\n\n' +
        '/chat list                — 查看当前在线用户\n' +
        '/chat search <关键词>     — 搜索用户（支持 handle 和显示名）\n' +
        '/chat send @handle 消息   — 发送消息给指定节点\n' +
        '/chat inbox               — 查看未读消息\n' +
        '/chat threads             — 查看会话列表\n' +
        '/chat reply <threadId> 消息 — 回复某个会话\n' +
        '/chat help                — 显示此帮助',
      )

    default:
      return replyText(
        `未知子命令 "${sub}"。\n` +
        '可用：list | search | send | inbox | threads | reply | help\n' +
        '输入 /chat help 查看帮助。',
      )
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
