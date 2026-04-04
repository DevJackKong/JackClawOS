/**
 * jackclaw send / inbox / status — 人话 CLI 快捷命令
 *
 * 不用输 `jackclaw social send`，直接：
 *   jackclaw send @bob "hello"
 *   jackclaw inbox
 *   jackclaw status
 */

import { Command } from 'commander'
import axios from 'axios'
import chalk from 'chalk'
import { loadConfig } from '../config-utils'

function getHub(opts: Record<string, any>): string {
  const cfg = loadConfig()
  return (opts.hub ?? cfg?.hubUrl ?? 'http://localhost:3100').replace(/\/$/, '')
}

function getHandle(opts: Record<string, any>): string {
  const cfg = loadConfig()
  return opts.handle ?? opts.from ?? (cfg as any)?.agentHandle ?? (cfg as any)?.handle ?? ''
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
  return `${Math.floor(diff / 86400_000)}d ago`
}

export function registerQuickCommands(program: Command): void {
  // ── jackclaw send @handle "message" ──────────────────────────────────────
  program
    .command('send <handle> <message>')
    .description('Send a message to @handle')
    .option('--hub <url>', 'Hub URL')
    .option('--from <handle>', 'Your @handle')
    .action(async (toHandle: string, message: string, opts: any) => {
      const hub = getHub(opts)
      const from = getHandle(opts)
      if (!from) {
        console.log(chalk.red('❌ Who are you? Set your handle with: jackclaw init'))
        return
      }
      const to = toHandle.startsWith('@') ? toHandle : `@${toHandle}`
      try {
        const res = await axios.post(`${hub}/api/social/send`, {
          fromHuman: 'cli-user',
          fromAgent: from,
          toAgent: to,
          content: message,
          type: 'text',
        })
        console.log(`✅ Sent to ${chalk.cyan(to)}`)
      } catch (err: any) {
        const msg = err.response?.data?.error ?? err.message
        console.log(chalk.red(`❌ ${msg}`))
      }
    })

  // ── jackclaw inbox ──────────────────────────────────────────────────────────
  program
    .command('inbox')
    .description('View your messages')
    .option('--hub <url>', 'Hub URL')
    .option('--handle <handle>', 'Your @handle')
    .option('-n <count>', 'Number of messages', '10')
    .action(async (opts: any) => {
      const hub = getHub(opts)
      const handle = getHandle(opts)
      if (!handle) {
        console.log(chalk.red('❌ Set your handle first: jackclaw init'))
        return
      }
      try {
        const res = await axios.get(`${hub}/api/social/messages`, {
          params: { agentHandle: handle, limit: opts.n || 10 },
        })
        const msgs = res.data.messages || []
        if (msgs.length === 0) {
          console.log('📭 No messages yet.')
          return
        }
        console.log(`📬 ${chalk.bold(handle)} — ${msgs.length} messages\n`)
        for (const m of msgs) {
          const from = chalk.cyan(m.fromAgent)
          const time = chalk.gray(timeAgo(m.ts))
          const preview = m.content.length > 80 ? m.content.slice(0, 80) + '…' : m.content
          console.log(`  ${from} ${time}`)
          console.log(`  ${preview}\n`)
        }
      } catch (err: any) {
        console.log(chalk.red(`❌ ${err.message}`))
      }
    })

  // ── jackclaw status ─────────────────────────────────────────────────────────
  program
    .command('hub-status')
    .description('Check Hub status')
    .option('--hub <url>', 'Hub URL')
    .action(async (opts: any) => {
      const hub = getHub(opts)
      try {
        const res = await axios.get(`${hub}/health/detailed`, { timeout: 5000 })
        const d = res.data
        console.log(`🟢 Hub Online — ${hub}\n`)
        console.log(`  Uptime:       ${Math.floor(d.uptime / 3600)}h ${Math.floor((d.uptime % 3600) / 60)}m`)
        console.log(`  Connections:  ${d.chat?.connections ?? '?'}`)
        console.log(`  Messages:     ${d.store?.totalMessages ?? '?'} total, ${d.chat?.totalDelivered ?? '?'} delivered`)
        console.log(`  Queue:        ${d.chat?.queueDepth ?? 0} pending, ${d.offlineQueue?.totalPending ?? 0} offline`)
        console.log(`  Latency:      ${d.chat?.avgLatencyMs ?? 0}ms avg`)
        console.log(`  Memory:       ${d.memory?.heapUsed ?? '?'}MB / ${d.memory?.heapTotal ?? '?'}MB`)
      } catch (err: any) {
        console.log(chalk.red(`🔴 Hub unreachable — ${hub}`))
        console.log(chalk.gray(`   ${err.message}`))
      }
    })
}
