/**
 * jackclaw start [--hub-only] [--node-only] [--hub-port 3100] [--node-port 19000]
 *               [--nodes <count>] [--tunnel [mode]] [--daemon]
 *
 * --daemon  : 后台运行，写 PID 文件到 ~/.jackclaw/jackclaw.pid
 *
 * 进程守护：每个子进程由 ProcessWatcher 管理：
 *   - 崩溃自动重启，最多 5 次 / 小时
 *   - 超限后告警（打印 + 写日志），不再重启
 *
 * 日志：stdout/stderr → ~/.jackclaw/logs/{hub,node}.log（按天轮转，保留 7 天）
 */

import { Command } from 'commander'
import { spawn } from 'child_process'
import net from 'net'
import path from 'path'
import http from 'http'
import fs from 'fs'
import os from 'os'
import chalk from 'chalk'
import { TunnelManager } from '@jackclaw/tunnel'
import { ProcessWatcher } from '../process-watcher'
import { LogWriter } from '../log-writer'
import { PID_FILE } from './stop'

// ─── PID file ──────────────────────────────────────────────────────────────────

function writePid(pid: number): void {
  const dir = path.dirname(PID_FILE)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(PID_FILE, String(pid), 'utf8')
}

function removePid(): void {
  try { if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE) } catch { /* ignore */ }
}

// ─── Port check ────────────────────────────────────────────────────────────────

function isPortInUse(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const s = net.createServer()
    s.once('error', (err: NodeJS.ErrnoException) => resolve(err.code === 'EADDRINUSE'))
    s.once('listening', () => { s.close(); resolve(false) })
    s.listen(port, '127.0.0.1')
  })
}

// ─── Health poll ───────────────────────────────────────────────────────────────

function waitForHealth(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    function attempt() {
      if (Date.now() > deadline) return reject(new Error(`Timed out waiting for ${url}`))
      http.get(url, res => {
        let body = ''
        res.on('data', c => { body += c })
        res.on('end', () => {
          try { if (JSON.parse(body).status === 'ok') return resolve() } catch {}
          setTimeout(attempt, 1000)
        })
      }).on('error', () => setTimeout(attempt, 1000))
    }
    attempt()
  })
}

// ─── Graceful shutdown ─────────────────────────────────────────────────────────

function shutdown(watchers: ProcessWatcher[]): void {
  console.log(chalk.yellow('\n[start] Shutting down...'))
  watchers.forEach(w => w.stop())
  removePid()
  setTimeout(() => process.exit(0), 1_200).unref()
}

// ─── Command ───────────────────────────────────────────────────────────────────

export function registerStart(program: Command): void {
  program
    .command('start')
    .description('Start JackClaw Hub and/or Node services')
    .option('--hub-only', 'Start Hub only')
    .option('--node-only', 'Start Node only')
    .option('--hub-port <port>', 'Hub HTTP port', '3100')
    .option('--node-port <port>', 'Node HTTP port', '19000')
    .option('--nodes <count>', 'Number of nodes to start', '1')
    .option('--tunnel [mode]', 'Enable tunnel: cloudflare (default) or selfhosted')
    .option('--daemon', 'Run in background (writes PID to ~/.jackclaw/jackclaw.pid)')
    .action(async (opts: {
      hubOnly?: boolean
      nodeOnly?: boolean
      hubPort: string
      nodePort: string
      nodes: string
      tunnel?: string | boolean
      daemon?: boolean
    }) => {

      // ── Daemon: re-spawn self without --daemon, detached ──────────────────
      if (opts.daemon) {
        const args = process.argv.slice(2).filter(a => a !== '--daemon')
        const logDir = path.join(os.homedir(), '.jackclaw', 'logs')
        fs.mkdirSync(logDir, { recursive: true })
        const daemonLog = path.join(logDir, 'daemon.log')
        const outFd = fs.openSync(daemonLog, 'a')

        const child = spawn(process.execPath, [process.argv[1], ...args], {
          detached: true,
          stdio: ['ignore', outFd, outFd],
          env: { ...process.env, JACKCLAW_DAEMON: '1' },
        })
        child.unref()

        writePid(child.pid!)
        console.log(chalk.green(`✓ JackClaw started in background (PID ${child.pid})`))
        console.log(chalk.gray(`  PID file:   ${PID_FILE}`))
        console.log(chalk.gray(`  Daemon log: ${daemonLog}`))
        process.exit(0)
      }

      // ── Normal (foreground) start ─────────────────────────────────────────
      const startHub  = !opts.nodeOnly
      const startNode = !opts.hubOnly
      const nodeCount = Math.max(1, parseInt(opts.nodes, 10) || 1)
      const hubPort   = parseInt(opts.hubPort, 10)
      const nodePort  = parseInt(opts.nodePort, 10)
      const tunnelMode = opts.tunnel === true ? 'cloudflare' : (opts.tunnel as string | undefined)

      const mono = path.resolve(__dirname, '../../../../')
      const hubScript  = path.join(mono, 'packages/hub/dist/index.js')
      const nodeScript = path.join(mono, 'packages/node/dist/index.js')

      const watchers: ProcessWatcher[] = []

      // Port pre-flight
      if (startHub && await isPortInUse(hubPort)) {
        console.error(chalk.red(`✗ Port ${hubPort} already in use (Hub). Use --hub-port to change.`))
        process.exit(1)
      }
      if (startNode && await isPortInUse(nodePort)) {
        console.error(chalk.red(`✗ Port ${nodePort} already in use (Node). Use --node-port to change.`))
        process.exit(1)
      }

      // Write PID for foreground mode too (useful for jackclaw stop)
      writePid(process.pid)

      // ── Hub ──────────────────────────────────────────────────────────────
      if (startHub) {
        console.log(chalk.blue(`[start] Spawning Hub on port ${hubPort}...`))
        const hubLog = new LogWriter('hub')
        const watcher = new ProcessWatcher({
          label: 'hub',
          script: hubScript,
          env: { HUB_PORT: String(hubPort) },
          logWriter: hubLog,
          onOverLimit: (label) => {
            console.error(chalk.red.bold(
              `[ProcessWatcher] ⚠ ${label} restart limit exceeded — check ${hubLog.logPath}`
            ))
          },
        })
        watcher.start()
        watchers.push(watcher)

        try {
          await waitForHealth(`http://localhost:${hubPort}/health`)
          console.log(chalk.green(`✅ Hub ready — http://localhost:${hubPort}`))
        } catch (e: any) {
          console.error(chalk.red(`✗ Hub not healthy: ${e.message}`))
          shutdown(watchers); return
        }
      }

      // ── Node(s) ──────────────────────────────────────────────────────────
      if (startNode) {
        const nodeLog = new LogWriter('node')
        for (let i = 0; i < nodeCount; i++) {
          const port = nodePort + i
          const label = nodeCount > 1 ? `node-${i + 1}` : 'node'

          if (await isPortInUse(port)) {
            console.error(chalk.red(`✗ Port ${port} already in use. Skipping ${label}.`))
            continue
          }

          console.log(chalk.green(`[start] Spawning ${label} on port ${port}...`))
          const watcher = new ProcessWatcher({
            label,
            script: nodeScript,
            env: { NODE_PORT: String(port), JACKCLAW_HUB_URL: `http://localhost:${hubPort}`, JACKCLAW_NODE_ID: label },
            logWriter: nodeLog,
            onOverLimit: (l) => {
              console.error(chalk.red.bold(
                `[ProcessWatcher] ⚠ ${l} restart limit exceeded — check ${nodeLog.logPath}`
              ))
            },
          })
          watcher.start()
          watchers.push(watcher)

          try {
            await waitForHealth(`http://localhost:${port}/health`)
            console.log(chalk.green(`✅ ${label} ready — http://localhost:${port}`))
          } catch (e: any) {
            console.error(chalk.red(`✗ ${label} not healthy: ${e.message}`))
          }
        }
      }

      if (watchers.length === 0) {
        console.error(chalk.red('Nothing to start.'))
        removePid()
        process.exit(1)
      }

      // ── Tunnel ────────────────────────────────────────────────────────────
      let tunnelUrl: string | null = null
      if (tunnelMode && startHub) {
        const validModes = ['cloudflare', 'selfhosted']
        const mode = validModes.includes(tunnelMode) ? tunnelMode as 'cloudflare' | 'selfhosted' : 'cloudflare'
        console.log(chalk.yellow(`[tunnel] Starting ${mode} tunnel for Hub port ${hubPort}...`))
        try {
          const tm = new TunnelManager({
            onUrl: (url) => {
              console.log(chalk.bold.yellow(`\n🌐 Public URL: ${url}`))
              console.log(chalk.gray(`   Share this with external nodes and teammates\n`))
            }
          })
          tunnelUrl = await tm.start(hubPort, mode)
          process.on('SIGINT',  () => { tm.stop().finally(() => shutdown(watchers)) })
          process.on('SIGTERM', () => { tm.stop().finally(() => shutdown(watchers)) })
        } catch (e: any) {
          console.warn(chalk.yellow(`[tunnel] Failed to start tunnel: ${e.message}`))
          console.warn(chalk.gray(`   Is cloudflared installed? brew install cloudflare/cloudflare/cloudflared`))
        }
      }

      console.log(chalk.bold('\n🦞 JackClaw is running'))
      if (startHub) {
        console.log(chalk.blue(`   Hub:       http://localhost:${hubPort}`))
        console.log(chalk.blue(`   Dashboard: http://localhost:${hubPort}`))
        if (tunnelUrl) console.log(chalk.bold.yellow(`   Public:    ${tunnelUrl}`))
      }
      if (startNode) console.log(chalk.green(`   Node: http://localhost:${nodePort}`))
      console.log(chalk.gray('   Ctrl+C to stop.\n'))

      if (!tunnelMode) {
        process.on('SIGINT',  () => shutdown(watchers))
        process.on('SIGTERM', () => shutdown(watchers))
      }
    })
}

// backward-compat alias
export { registerStart as registerStartCommand }
