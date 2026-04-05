/**
 * jackclaw team start --config jackclaw.yaml
 *
 * 从 YAML 配置文件启动一个完整的 AI 团队。
 *
 * jackclaw.yaml 格式：
 * hub:
 *   port: 3100
 *
 * nodes:
 *   - id: cto
 *     name: "CTO - 技术总监"
 *     role: cto
 *     systemPrompt: "你是 CTO，负责技术架构和工程决策"
 *     model: gpt-4o
 *
 *   - id: cmo
 *     name: "CMO - 市场总监"
 *     role: cmo
 *     systemPrompt: "你是 CMO，负责市场策略和品牌"
 *     model: claude-sonnet-4
 *
 *   - id: cdo
 *     name: "CDO - 数据总监"
 *     role: cdo
 *     systemPrompt: "你是 CDO，负责数据分析和洞察"
 *     model: deepseek-chat
 */

import { Command } from 'commander'
import fs from 'fs'
import path from 'path'
import http from 'http'
import net from 'net'
import { load as yamlLoad } from 'js-yaml'
import chalk from 'chalk'
import { AutoReplyHandler } from '@jackclaw/node'
import { ProcessWatcher } from '../process-watcher'
import { LogWriter } from '../log-writer'

// ─── Config types ───────────────────────────────────────────────────────────

interface NodeConfig {
  id: string
  name: string
  role: string
  systemPrompt?: string
  model?: string
}

interface TeamConfig {
  hub?: {
    port?: number
  }
  nodes: NodeConfig[]
}

// ─── YAML loader ─────────────────────────────────────────────────────────────

function loadTeamConfig(configPath: string): TeamConfig {
  const abs = path.resolve(configPath)
  if (!fs.existsSync(abs)) {
    throw new Error(`Config file not found: ${abs}`)
  }
  const raw = fs.readFileSync(abs, 'utf8')
  const parsed = yamlLoad(raw) as any

  if (!parsed || !Array.isArray(parsed.nodes) || parsed.nodes.length === 0) {
    throw new Error('Invalid config: "nodes" array is required and must not be empty')
  }

  for (const node of parsed.nodes) {
    if (!node.id || !node.name || !node.role) {
      throw new Error(`Invalid node config: each node must have "id", "name", and "role". Got: ${JSON.stringify(node)}`)
    }
  }

  return parsed as TeamConfig
}

// ─── Port helpers ────────────────────────────────────────────────────────────

function isPortInUse(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const s = net.createServer()
    s.once('error', (err: NodeJS.ErrnoException) => resolve(err.code === 'EADDRINUSE'))
    s.once('listening', () => { s.close(); resolve(false) })
    s.listen(port, '127.0.0.1')
  })
}

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

// ─── Hub registration (best-effort) ──────────────────────────────────────────

async function registerNodeWithHub(hubUrl: string, node: NodeConfig): Promise<void> {
  const payload = JSON.stringify({
    nodeId: node.id,
    name: node.name,
    role: node.role,
    // Placeholder public key — team nodes use AutoReplyHandler (WS-only), not full crypto
    publicKey: `team-node-placeholder-${node.id}`,
  })

  await new Promise<void>((resolve) => {
    const url = new URL(`${hubUrl}/api/register`)
    const opts = {
      hostname: url.hostname,
      port: Number(url.port) || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }
    const req = http.request(opts, (res) => {
      res.resume() // drain
      resolve()
    })
    req.on('error', () => resolve()) // best-effort
    req.write(payload)
    req.end()
  })
}

// ─── Status table ─────────────────────────────────────────────────────────────

interface NodeStatus {
  id: string
  name: string
  model: string
  status: 'connecting' | 'connected' | 'error'
}

function printStatusTable(hubUrl: string, statuses: NodeStatus[]): void {
  const col1 = Math.max(4, ...statuses.map(s => s.id.length)) + 2
  const col2 = Math.max(4, ...statuses.map(s => s.name.length)) + 2
  const col3 = Math.max(5, ...statuses.map(s => s.model.length)) + 2
  const col4 = 12

  const header = [
    'ID'.padEnd(col1),
    'Name'.padEnd(col2),
    'Model'.padEnd(col3),
    'Status'.padEnd(col4),
  ].join(' | ')

  const sep = '-'.repeat(header.length)

  console.log(chalk.bold('\n🦞 JackClaw Team Status'))
  console.log(chalk.blue(`   Hub: ${hubUrl}`))
  console.log()
  console.log(chalk.gray(sep))
  console.log(chalk.bold(header))
  console.log(chalk.gray(sep))

  for (const s of statuses) {
    const statusStr = s.status === 'connected'
      ? chalk.green('● connected')
      : s.status === 'connecting'
        ? chalk.yellow('○ connecting')
        : chalk.red('✗ error')

    console.log([
      s.id.padEnd(col1),
      s.name.padEnd(col2),
      s.model.padEnd(col3),
      statusStr,
    ].join(' | '))
  }

  console.log(chalk.gray(sep))
  console.log(chalk.gray('\n   Ctrl+C to shut down all nodes.\n'))
}

// ─── Command ──────────────────────────────────────────────────────────────────

export function registerTeam(program: Command): void {
  const teamCmd = program
    .command('team')
    .description('Manage AI teams from a YAML config file')

  teamCmd
    .command('start')
    .description('Start a full AI team from jackclaw.yaml')
    .option('-c, --config <file>', 'Path to team config YAML file', 'jackclaw.yaml')
    .action(async (opts: { config: string }) => {
      // 1. Load config
      let config: TeamConfig
      try {
        config = loadTeamConfig(opts.config)
      } catch (err: any) {
        console.error(chalk.red(`✗ ${err.message}`))
        process.exit(1)
      }

      const hubPort = config.hub?.port ?? 3100
      const hubUrl = `http://localhost:${hubPort}`
      const handlers: AutoReplyHandler[] = []
      let hubWatcher: ProcessWatcher | null = null

      // 2. Ensure Hub is running
      const hubRunning = await isPortInUse(hubPort)
      if (!hubRunning) {
        console.log(chalk.blue(`[team] Hub not running — starting Hub on port ${hubPort}...`))
        const hubScript = require.resolve('@jackclaw/hub')
        const hubLog = new LogWriter('hub')
        hubWatcher = new ProcessWatcher({
          label: 'hub',
          script: hubScript,
          env: { HUB_PORT: String(hubPort) },
          logWriter: hubLog,
          onOverLimit: () => {
            console.error(chalk.red.bold(`[team] Hub restart limit exceeded — check ${hubLog.logPath}`))
          },
        })
        hubWatcher.start()

        try {
          await waitForHealth(`${hubUrl}/health`)
          console.log(chalk.green(`✅ Hub ready — ${hubUrl}`))
        } catch (err: any) {
          console.error(chalk.red(`✗ Hub not healthy: ${err.message}`))
          hubWatcher.stop()
          process.exit(1)
        }
      } else {
        console.log(chalk.green(`✅ Hub already running — ${hubUrl}`))
      }

      // 3. Register + connect each node
      const statuses: NodeStatus[] = config.nodes.map(n => ({
        id: n.id,
        name: n.name,
        model: n.model ?? 'claude-3-5-haiku-20241022',
        status: 'connecting',
      }))

      for (let i = 0; i < config.nodes.length; i++) {
        const nodeConf = config.nodes[i]
        const model = nodeConf.model ?? 'claude-3-5-haiku-20241022'

        // Register with Hub (best-effort)
        await registerNodeWithHub(hubUrl, nodeConf)

        // Create AutoReplyHandler
        const handler = new AutoReplyHandler({
          nodeId: nodeConf.id,
          hubUrl,
          systemPrompt: nodeConf.systemPrompt,
          model,
        })

        handler.start()
        handlers.push(handler)

        // Poll for connection (give it up to 5s)
        const deadline = Date.now() + 5_000
        while (!handler.isConnected() && Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 200))
        }

        statuses[i].status = handler.isConnected() ? 'connected' : 'error'
      }

      // 4. Print status table
      printStatusTable(hubUrl, statuses)

      // 5. Graceful shutdown
      function shutdown() {
        console.log(chalk.yellow('\n[team] Shutting down all nodes...'))
        handlers.forEach(h => h.stop())
        hubWatcher?.stop()
        setTimeout(() => process.exit(0), 1_200).unref()
      }

      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
    })
}
