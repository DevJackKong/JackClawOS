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
  fetchNodes,
  fetchSummary,
  formatNodeStatus,
  formatSummary,
  hubHealthCheck,
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

export const JACKCLAW_COMMANDS: OpenClawPluginCommandDefinition[] = [
  {
    name: 'jackclaw',
    description: 'JackClaw — 查询团队汇报和节点状态',
    acceptsArgs: true,
    requireAuth: true,
    handler: jackclawCommandHandler,
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
