/**
 * CLI command: jackclaw logs [nodeId]
 * View recent node health stats and activity logs via Watchdog
 */
import { Command } from 'commander'
import chalk from 'chalk'
import axios from 'axios'
import { loadConfig, loadState } from '../config-utils.js'

function fmtBytes(n: number): string {
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`
  if (n > 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${n}B`
}
function fmtUptime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function registerLogs(program: Command): void {
  program
    .command('logs [nodeId]')
    .description('View node health and activity via Watchdog')
    .option('--watch', 'Refresh every 5 seconds')
    .option('--json', 'Output raw JSON')
    .action(async (nodeId: string | undefined, opts: { watch?: boolean; json?: boolean }) => {
      const config = loadConfig()
      const state = loadState()
      const hubUrl = config?.hubUrl || process.env.HUB_URL
      const token = state?.token || process.env.HUB_TOKEN

      if (!hubUrl) {
        console.error(chalk.red('✗ Hub URL not configured.'))
        process.exit(1)
      }

      const headers = token ? { Authorization: `Bearer ${token}` } : {}

      async function fetch() {
        const url = nodeId
          ? `${hubUrl}/api/watchdog/status/${nodeId}`
          : `${hubUrl}/api/watchdog/status`

        try {
          const res = await axios.get(url, { headers, timeout: 10000 })
          return res.data
        } catch (err: any) {
          if (err?.response?.status === 404) return null
          throw err
        }
      }

      async function render() {
        const data = await fetch()
        if (!data) {
          console.log(chalk.gray(nodeId ? `Node ${nodeId} not found` : 'No watchdog data'))
          return
        }

        if (opts.json) {
          console.log(JSON.stringify(data, null, 2))
          return
        }

        if (nodeId) {
          // Single node view
          const n = data.node || data
          console.clear()
          console.log('')
          console.log(chalk.bold(`Node: ${n.nodeId ?? nodeId}`))
          console.log(chalk.gray('─'.repeat(50)))
          console.log(`Status:   ${n.status === 'online' ? chalk.green('● online') : chalk.red('● offline')}`)
          if (n.metrics) {
            console.log(`Memory:   ${chalk.cyan(fmtBytes(n.metrics.memUsage ?? 0))}`)
            console.log(`Uptime:   ${chalk.cyan(fmtUptime(n.metrics.uptime ?? 0))}`)
            console.log(`CPU Load: ${chalk.cyan((n.metrics.cpuLoad ?? 0).toFixed(2))}`)
            console.log(`Tasks:    ${chalk.cyan(n.metrics.tasksCompleted ?? 0)}`)
          }
          const ago = n.lastSeenAt ? Math.round((Date.now() - n.lastSeenAt) / 1000) : null
          if (ago !== null) console.log(`Last seen: ${chalk.gray(ago + 's ago')}`)
        } else {
          // All nodes view
          const nodes = data.nodes || data
          console.clear()
          console.log('')
          console.log(chalk.bold('Watchdog — Node Health'))
          console.log(chalk.gray('─'.repeat(72)))
          console.log(
            chalk.bold('NODE ID'.padEnd(24)) +
            chalk.bold('STATUS'.padEnd(10)) +
            chalk.bold('MEM'.padEnd(10)) +
            chalk.bold('UPTIME'.padEnd(10)) +
            chalk.bold('TASKS')
          )
          console.log(chalk.gray('─'.repeat(72)))

          for (const [nid, entry] of Object.entries(nodes as Record<string, any>)) {
            const e = entry as any
            const status = e.status === 'online' ? chalk.green('● online') : chalk.red('● offline')
            const mem = fmtBytes(e.metrics?.memUsage ?? 0)
            const up  = fmtUptime(e.metrics?.uptime ?? 0)
            const tasks = String(e.metrics?.tasksCompleted ?? 0)
            console.log(
              chalk.cyan(nid.padEnd(24)) +
              status.padEnd(18) +
              chalk.cyan(mem.padEnd(10)) +
              chalk.cyan(up.padEnd(10)) +
              chalk.cyan(tasks)
            )
          }
          const count = Object.keys(nodes).length
          console.log(chalk.gray(`\n${count} node(s)  •  ${new Date().toLocaleTimeString()}`))
        }
      }

      await render()

      if (opts.watch) {
        setInterval(render, 5000)
      }
    })
}
