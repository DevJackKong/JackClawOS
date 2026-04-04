// ── Global error handlers — must be first ───────────────────────────────────
process.on('uncaughtException', (err: Error) => {
  console.error('[fatal] uncaughtException:', err.stack ?? err.message)
  // Keep process alive — log and continue
})

process.on('unhandledRejection', (reason: unknown) => {
  const msg = reason instanceof Error ? reason.stack ?? reason.message : String(reason)
  console.error('[fatal] unhandledRejection:', msg)
  // Keep process alive — log and continue
})

import cron from 'node-cron'
import { loadConfig } from './config'
import { loadOrCreateIdentity } from './identity'
import { createServer, registerHarnessRunner, handleTask } from './server'
import { registerWithHub, sendReportToHub } from './hub'
import { buildDailyReport } from './reporter'
import { createMessage } from '@jackclaw/protocol'
import { getAiClient } from './ai-client'
import { NodeChatClient } from './chat-client'
import { getOwnerMemory } from './owner-memory'
import { MemoryManager, MemDirSync } from '@jackclaw/memory'
import { createNodeGateway } from './llm-gateway'
import { SocialHandler } from './social-handler'
import { AiSecretary } from './ai-secretary'
import { createConcierge } from './ai-concierge'

async function main() {
  console.log('🦞 JackClaw Node starting...')

  const config = loadConfig()
  const identity = loadOrCreateIdentity({
    displayName: config.nodeName ?? config.nodeId ?? undefined,
    role: config.nodeRole ?? undefined,
  })

  if (config.nodeId) {
    identity.nodeId = config.nodeId
  }

  console.log(`[node] Node ID: ${identity.nodeId}`)
  console.log(`[node] Hub: ${config.hubUrl}`)
  console.log(`[node] Port: ${config.port}`)

  // 0. Initialize LLM Gateway
  const gateway = createNodeGateway(config)

  // 1. Register with Hub (best-effort, non-blocking)
  await registerWithHub(identity, config)

  // 1b. Connect NodeChatClient to Hub ClawChat
  const ownerMemory = getOwnerMemory(identity.nodeId)
  const chatClient = new NodeChatClient(identity.nodeId, config.hubUrl)

  // 1c. Init Social Handler
  const socialHandler = new SocialHandler({
    nodeId: identity.nodeId,
    agentHandle: (config as any).agentHandle,
    hubUrl: config.hubUrl,
    webhookUrl: (config as any).webhookUrl,
    humanId: (config as any).humanId,
  })

  // 1d. Init AI Concierge
  const concierge = createConcierge({
    nodeId: identity.nodeId,
    hubUrl: config.hubUrl,
    agentHandle: (config as any).agentHandle,
  })

  // 1e. AI Secretary — initialized after aiClient; messages arrive async so this is safe
  let secretary: AiSecretary | null = null

  chatClient.onMessage((msg) => {
    // Route social events to SocialHandler first
    if (msg.type === 'social' || msg.type === 'social_contact_request' || msg.type === 'social_contact_response') {
      socialHandler.handleEvent(msg.type, msg)
      return
    }
    if (msg.type === 'task') {
      handleTask(
        { taskId: msg.id, action: 'ai', params: { prompt: msg.content, title: `chat:${msg.id}` } },
        identity,
        config,
      )
    } else if (msg.type === 'human') {
      ownerMemory.observeMessage({ content: msg.content, direction: 'incoming', type: msg.type })
      if (secretary) {
        // Secretary decides whether/how to notify owner
        secretary.handleIncoming({ id: msg.id, from: msg.from, content: msg.content, type: msg.type, ts: Date.now() })
          .catch((err: Error) => console.error('[secretary] handleIncoming error:', err.message))
      }
    }
  })

  chatClient.connect()

  // 2. Start HTTP server
  const app = createServer(identity, config, chatClient)
  app.listen(config.port, () => {
    console.log(`[server] Listening on port ${config.port}`)
  })

  // 3. Init AI client + Harness runner
  const aiClient = getAiClient(identity.nodeId, config)
  console.log('[ai] AiClient initialized — cache probe will run on first call')

  // 3a. Init AI Secretary
  secretary = new AiSecretary({
    aiClient,
    ownerMemory,
    notifyOwner: (msg, priority) => {
      console.log(`[secretary] 📬 [${priority}] from=${msg.from}: ${msg.content.slice(0, 80)}`)
    },
    sendReply: async (to, content) => {
      chatClient.send(to, content, 'human')
    },
  })
  console.log(`[secretary] Initialized — mode: ${secretary.getMode()}`)

  // 注册 Harness runner（运行时注入，编译期无跨包依赖）
  try {
    const { getHarnessRegistry, buildDefaultContext } = await import('../../harness/src/index.js' as any)
    const registry = await getHarnessRegistry()
    const harnessContext = buildDefaultContext({ nodeId: identity.nodeId, hubUrl: config.hubUrl })
    registerHarnessRunner(async (opts) => {
      const session = registry.spawnBest(
        { id: opts.taskId, title: opts.title, description: opts.description, workdir: opts.workdir, requireHumanApproval: opts.requireApproval },
        harnessContext,
      )
      const result = await session.run()
      return { status: result.status, attempts: result.attempts }
    })
    console.log('[harness] Runner registered — available:', registry.getAvailable().join(', ') || 'none')
  } catch {
    console.log('[harness] Package not available in this environment, skipping')
  }

  // 3b. Memory sync — startup pull + every 6 hours
  const memManager = new MemoryManager()
  const memSync = new MemDirSync(identity.nodeId)

  async function runMemorySync() {
    if (!config.visibility.shareMemory) return
    try {
      // push local shared project/reference entries to Hub
      const { entries } = memManager.syncSummary(identity.nodeId)
      await memSync.push(entries, config.hubUrl)
      // pull other nodes' entries and merge into local shared scope
      const remote = await memSync.pull(identity.nodeId, config.hubUrl)
      for (const e of remote) {
        // avoid duplicates: skip if same id already stored locally
        const existing = memManager.query(identity.nodeId, { scope: 'shared' })
        if (!existing.some(x => x.id === e.id)) {
          memManager.save({ ...e, nodeId: identity.nodeId, scope: 'shared' })
        }
      }
      console.log(`[memory-sync] done — pushed ${entries.length}, pulled ${remote.length}`)
    } catch (err: any) {
      console.error('[memory-sync] error:', err.message)
    }
  }

  // pull once at startup
  runMemorySync().catch(() => {})

  // repeat every 6 hours
  cron.schedule('0 */6 * * *', () => {
    runMemorySync().catch(() => {})
  })
  console.log('[cron] Memory sync scheduled: every 6 hours')

  // 3. Schedule daily report
  if (!cron.validate(config.reportCron)) {
    console.error(`[cron] Invalid cron expression: "${config.reportCron}", using default "0 8 * * *"`)
    config.reportCron = '0 8 * * *'
  }

  console.log(`[cron] Report scheduled: ${config.reportCron}`)

  cron.schedule(config.reportCron, async () => {
    console.log('[cron] Generating daily report...')
    try {
      const report = buildDailyReport(config)

      // Append SmartCache savings to report
      const savings = aiClient.getSavingsReport('today')
      ;(report as any).tokenSavings = {
        savedTokens: savings.totalSavedTokens,
        savingsRate: `${(savings.savingsRate * 100).toFixed(1)}%`,
        estimatedCostSaved: `$${savings.estimatedCostSaved.toFixed(4)}`,
        strategy: savings.byStrategy,
      }

      // Encrypt for Hub (if Hub public key available) or send plaintext wrapped
      const hubPublicKey: string | undefined = (config as any).hubPublicKey

      if (hubPublicKey) {
        const msg = createMessage(
          identity.nodeId,
          'hub',
          'report',
          report,
          hubPublicKey,
          identity.privateKey,
        )
        await sendReportToHub(identity.nodeId, JSON.stringify(msg), config)
      } else {
        // Dev mode: send unencrypted (wrapped in plain JSON)
        console.warn('[cron] Hub public key not set — sending unencrypted report (dev mode)')
        await sendReportToHub(identity.nodeId, JSON.stringify({ plain: true, report }), config)
      }
    } catch (err: any) {
      console.error('[cron] Report failed:', err.message)
    }
  })

  // 4. Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('[node] SIGTERM received, shutting down.')
    chatClient.stop()
    process.exit(0)
  })
  process.on('SIGINT', () => {
    console.log('[node] SIGINT received, shutting down.')
    chatClient.stop()
    process.exit(0)
  })

  console.log('🦞 JackClaw Node ready.')
}

main().catch((err) => {
  console.error('[fatal]', err)
  process.exit(1)
})
