/**
 * plugin.ts — JackClaw OpenClaw Plugin main body.
 *
 * Implements:
 *   1. Slash-commands (/jackclaw status, /jackclaw report, /jackclaw help)
 *   2. Natural-language intercept via inbound_claim hook
 *   3. Background service: polls Hub every 60 s and pushes new-report
 *      notifications to the CEO's configured delivery channel.
 */

import type {
  OpenClawPluginApi,
  OpenClawPluginService,
  OpenClawPluginServiceContext,
} from 'openclaw/plugin-sdk/plugin-entry'
import { JACKCLAW_COMMANDS, matchNaturalLanguage, handleReport, handleStatus } from './commands.js'
import {
  fetchSummary,
  hubHealthCheck,
  formatSummary,
  formatNodeStatus,
  fetchNodes,
  ensureClawChatAuth,
  setHubUrl,
} from './bridge.js'
import { initPluginChatClient, getPluginChatClient } from './chat-bridge.js'

/** Minimal delivery helper — calls the Gateway deliver endpoint if configured. */
async function pushNotification(text: string, ctx: OpenClawPluginServiceContext): Promise<void> {
  const cfg = ctx.config as Record<string, unknown>
  const pluginCfg = (cfg['plugins'] as Record<string, unknown> | undefined)?.['jackclaw'] as
    | Record<string, unknown>
    | undefined

  const deliveryTo = (pluginCfg?.['notifyTo'] as string | undefined) ?? ''
  const deliveryChannel = (pluginCfg?.['notifyChannel'] as string | undefined) ?? ''

  if (!deliveryTo || !deliveryChannel) {
    ctx.logger.info('[jackclaw] no notifyTo/notifyChannel configured — skipping push')
    return
  }

  // Use OpenClaw's runtime deliver API when available
  const runtime = (ctx as unknown as { runtime?: { deliver?: (params: unknown) => Promise<void> } }).runtime
  if (runtime?.deliver) {
    try {
      await runtime.deliver({ to: deliveryTo, channel: deliveryChannel, text })
      ctx.logger.info(`[jackclaw] pushed notification to ${deliveryTo} via ${deliveryChannel}`)
    } catch (err) {
      ctx.logger.warn(`[jackclaw] deliver failed: ${String(err)}`)
    }
  } else {
    // Fallback: log to console for manual piping
    ctx.logger.info(`[jackclaw] notification (${deliveryChannel} → ${deliveryTo}):\n${text}`)
  }
}

/** Build the background polling service. */
function buildJackclawService(hubUrl: string, autoRegister: boolean): OpenClawPluginService {
  let stopped = false
  let lastReportingNodes = 0
  // Dedup window: message id → arrival timestamp (purged after 60 s)
  const recentMessageIds = new Map<string, number>()

  return {
    id: 'jackclaw-hub-poller',
    async start(ctx: OpenClawPluginServiceContext) {
      ctx.logger.info('[jackclaw] Hub poller started (interval: 60s)')
      stopped = false

      // ── Apply Hub URL from config ─────────────────────────────────────────
      setHubUrl(hubUrl)
      ctx.logger.info(`[jackclaw] Hub URL: ${hubUrl}`)

      // ── Auto-register / refresh ClawChat Hub account on first load ──────
      let chatToken = ''
      if (autoRegister) {
        try {
          // Prefer OpenClaw user identity when available, fall back to random handle.
          const cfg = ctx.config as Record<string, unknown>
          const identity = (cfg['user'] as Record<string, unknown> | undefined)?.['handle'] as string | undefined
          const { handle, token, isNew } = await ensureClawChatAuth(hubUrl, identity)
          chatToken = token
          ctx.logger.info(`[jackclaw] ClawChat auth ready (handle: ${handle})`)

          // On first registration, send a welcome message via pushNotification
          if (isNew) {
            const welcomeText =
              `🦞 ClawChat 已就绪！你的账号: @${handle}\n` +
              `使用 /chat send @someone 消息 开始聊天`
            await pushNotification(welcomeText, ctx)
          }
        } catch (err) {
          // Non-fatal: plugin still works without ClawChat registration.
          ctx.logger.warn(`[jackclaw] ClawChat auto-register failed: ${String(err)}`)
        }
      } else {
        ctx.logger.info('[jackclaw] autoRegister disabled — skipping ClawChat registration')
      }

      // ── Start WebSocket chat client ───────────────────────────────────────
      if (chatToken) {
        const chatClient = initPluginChatClient(hubUrl, chatToken)

        // Push inbound ClawChat messages to the OpenClaw delivery channel
        chatClient.onMessage((raw) => {
          const msg = raw as { id?: string; from?: string; to?: string; content?: string; type?: string }
          const id = typeof msg.id === 'string' ? msg.id : ''
          if (!id) return

          // 60-second dedup window
          const now = Date.now()
          if (recentMessageIds.has(id)) return
          recentMessageIds.set(id, now)
          // Purge expired entries
          for (const [k, ts] of recentMessageIds) {
            if (now - ts > 60_000) recentMessageIds.delete(k)
          }

          const from = typeof msg.from === 'string' ? msg.from : 'unknown'
          const content = typeof msg.content === 'string' ? msg.content : ''
          const icon = msg.type === 'task' ? '🔧' : '💬'
          const text = `${icon} ClawChat | @${from}: ${content}`

          void pushNotification(text, ctx)
        })

        chatClient.connect()
        ctx.logger.info('[jackclaw] PluginChatClient connected')
      }

      const poll = async () => {
        if (stopped) return

        try {
          const alive = await hubHealthCheck()
          if (!alive) {
            ctx.logger.info('[jackclaw] Hub unreachable, skipping poll')
            return
          }

          const summary = await fetchSummary()
          const currentCount = summary.reportingNodes

          // Notify CEO when new reports arrive
          if (currentCount > lastReportingNodes) {
            const newCount = currentCount - lastReportingNodes
            const text =
              `🔔 JackClaw 新汇报\n有 ${newCount} 个节点提交了新汇报。\n\n` +
              formatSummary(summary)
            await pushNotification(text, ctx)
          }

          lastReportingNodes = currentCount
        } catch (err) {
          ctx.logger.warn(`[jackclaw] poll error: ${String(err)}`)
        }
      }

      // Initial poll after startup
      setTimeout(poll, 5000)

      // Recurring poll
      const interval = setInterval(poll, 60_000)

      // Store interval so stop() can clear it
      ;(this as unknown as { _interval?: ReturnType<typeof setInterval> })._interval = interval
    },
    async stop(ctx: OpenClawPluginServiceContext) {
      stopped = true
      const self = this as unknown as { _interval?: ReturnType<typeof setInterval> }
      if (self._interval) {
        clearInterval(self._interval)
        delete self._interval
      }
      // Stop WebSocket chat client
      const chatClient = getPluginChatClient()
      if (chatClient) {
        chatClient.stop()
        ctx.logger.info('[jackclaw] PluginChatClient stopped')
      }
      ctx.logger.info('[jackclaw] Hub poller stopped')
    },
  }
}

/** Register the JackClaw plugin with OpenClaw. */
export function registerJackclawPlugin(api: OpenClawPluginApi): void {
  // ── Resolve plugin config (openclaw.yaml → env var → default) ──────────
  const globalCfg = api.config as Record<string, unknown>
  // Support both: plugins.entries.jackclaw.config and plugins.jackclaw.config
  const entriesCfg = (globalCfg['plugins'] as Record<string, unknown> | undefined)?.['entries'] as
    | Record<string, unknown>
    | undefined
  const pluginSection =
    (entriesCfg?.['jackclaw'] as Record<string, unknown> | undefined) ??
    ((globalCfg['plugins'] as Record<string, unknown> | undefined)?.['jackclaw'] as
      | Record<string, unknown>
      | undefined)
  const pluginConfig = (pluginSection?.['config'] as Record<string, unknown> | undefined) ?? {}

  const hubUrl: string =
    (pluginConfig['hubUrl'] as string | undefined) ??
    process.env['JACKCLAW_HUB_URL'] ??
    'https://hub.jackclaw.ai'

  // autoRegister defaults to true; set to false in config to skip registration
  const autoRegister: boolean = pluginConfig['autoRegister'] !== false

  api.logger.info(`[jackclaw] config — hubUrl: ${hubUrl}, autoRegister: ${autoRegister}`)

  // 1. Register slash commands
  for (const cmd of JACKCLAW_COMMANDS) {
    api.registerCommand(cmd)
  }

  // 2. Natural-language intercept via inbound_claim hook
  api.on('inbound_claim', async (event, _ctx) => {
    const match = matchNaturalLanguage(event.content)
    if (!match) return undefined

    // Build a synthetic PluginCommandContext-like object (minimal)
    const fakeCtx = {
      channel: _ctx.channelId ?? 'unknown',
      isAuthorizedSender: event.commandAuthorized ?? false,
      config: api.config,
      commandBody: event.content,
      args: '',
      requestConversationBinding: async () => ({ status: 'error' as const, message: 'not supported' }),
      detachConversationBinding: async () => ({ removed: false }),
      getCurrentConversationBinding: async () => null,
    }

    let result
    if (match === 'report') {
      result = await handleReport(fakeCtx as Parameters<typeof handleReport>[0])
    } else {
      result = await handleStatus(fakeCtx as Parameters<typeof handleStatus>[0])
    }

    // Return handled=true so OpenClaw skips the LLM agent for this message
    // Note: inbound_claim result shape is { handled: boolean }
    // We log the reply; actual delivery happens via the channel's reply pipeline
    api.logger.info(`[jackclaw] natural-language intercept (${match}): ${result.text?.slice(0, 80)}…`)

    // We can't directly reply here, but we signal that we handled it.
    // The full reply goes through the before_dispatch hook below.
    return { handled: false } // let the agent handle but with context
  })

  // 3. before_dispatch hook: intercept natural-language triggers before LLM
  api.on('before_dispatch', async (event, _ctx) => {
    const match = matchNaturalLanguage(event.content ?? '')
    if (!match) return undefined

    try {
      let text: string
      if (match === 'report') {
        const alive = await hubHealthCheck()
        if (!alive) {
          text = '⚠️ JackClaw Hub 离线，无法获取汇报数据。'
        } else {
          const summary = await fetchSummary()
          text = formatSummary(summary)
        }
      } else {
        const alive = await hubHealthCheck()
        if (!alive) {
          text = '⚠️ JackClaw Hub 离线，无法获取节点状态。'
        } else {
          const nodes = await fetchNodes()
          text = formatNodeStatus(nodes)
        }
      }

      return { handled: true, text }
    } catch (err) {
      api.logger.warn(`[jackclaw] before_dispatch error: ${String(err)}`)
      return { handled: true, text: `❌ JackClaw 查询失败：${String(err)}` }
    }
  })

  // 4. Register background Hub poller service
  api.registerService(buildJackclawService(hubUrl, autoRegister))

  api.logger.info('[jackclaw] JackClaw plugin registered ✅')
}
