/**
 * CLI commands: jackclaw task & jackclaw ask (shortcut)
 *
 * jackclaw task run '<prompt>'        — 提交任务
 * jackclaw task status <id>           — 查询状态
 * jackclaw task list                  — 任务列表
 * jackclaw ask '<prompt>'             — 快捷聊天 (= task run --type chat)
 */

import { Command } from 'commander'
import chalk from 'chalk'
import axios from 'axios'
import { loadConfig, loadState } from '../config-utils.js'

function hubHeaders(token?: string) {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function getHubBase(): { hubUrl: string; token?: string } {
  const config = loadConfig()
  const state = loadState()
  const hubUrl = config?.hubUrl || process.env.HUB_URL
  if (!hubUrl) {
    console.error(chalk.red('✗ Hub URL not configured. Run: jackclaw init or set HUB_URL'))
    process.exit(1)
  }
  return { hubUrl, token: state?.token || process.env.HUB_TOKEN }
}

export function registerTask(program: Command): void {
  const task = program
    .command('task')
    .description('Submit and manage LLM tasks')

  // jackclaw task run '<prompt>'
  task
    .command('run <prompt>')
    .description('Submit a task to a node for LLM execution')
    .option('--type <type>', 'Task type: chat|code|research|analyze|create|custom', 'chat')
    .option('--node <nodeId>', 'Target a specific node')
    .option('--model <model>', 'Model override')
    .option('--max-tokens <n>', 'Max tokens', parseInt)
    .option('--context <ctx>', 'Additional context')
    .option('--json', 'Output raw JSON')
    .action(async (prompt: string, opts: {
      type?: string; node?: string; model?: string;
      maxTokens?: number; context?: string; json?: boolean
    }) => {
      const { hubUrl, token } = getHubBase()

      console.log(chalk.gray(`Submitting ${opts.type ?? 'chat'} task...`))

      try {
        const res = await axios.post(`${hubUrl}/api/tasks/submit`, {
          type: opts.type ?? 'chat',
          prompt,
          nodeId: opts.node,
          model: opts.model,
          maxTokens: opts.maxTokens,
          context: opts.context,
        }, {
          headers: hubHeaders(token),
          timeout: 130000,
        })

        if (opts.json) {
          console.log(JSON.stringify(res.data, null, 2))
          return
        }

        const d = res.data
        console.log('')
        if (d.output) console.log(chalk.white(d.output))
        else if (d.error) console.log(chalk.red(`Error: ${d.error}`))

        console.log(chalk.gray(`\n↳ task: ${d.taskId}`))
        if (d.model) console.log(chalk.gray(`  model: ${d.model}`))
        if (d.tokenUsage) {
          console.log(chalk.gray(`  tokens: in=${d.tokenUsage.input} out=${d.tokenUsage.output}`))
        }
        if (d.duration) console.log(chalk.gray(`  duration: ${d.duration}ms`))
        if (d.toolCalls?.length) {
          console.log(chalk.gray(`  tool calls: ${d.toolCalls.length}`))
        }
      } catch (err: any) {
        const msg = err?.response?.data?.error || err?.message || String(err)
        console.error(chalk.red(`✗ ${msg}`))
        process.exit(1)
      }
    })

  // jackclaw task status <id>
  task
    .command('status <id>')
    .description('Query task status')
    .option('--json', 'Output raw JSON')
    .action(async (id: string, opts: { json?: boolean }) => {
      const { hubUrl, token } = getHubBase()

      try {
        const res = await axios.get(`${hubUrl}/api/tasks/${id}`, {
          headers: hubHeaders(token),
          timeout: 10000,
        })
        if (opts.json) {
          console.log(JSON.stringify(res.data, null, 2))
          return
        }
        const d = res.data
        const statusColor = {
          completed: chalk.green,
          running: chalk.yellow,
          failed: chalk.red,
          cancelled: chalk.gray,
          pending: chalk.blue,
        }[d.status as string] ?? chalk.white

        console.log(`Task: ${chalk.bold(d.id)}`)
        console.log(`Status: ${statusColor(d.status)}`)
        if (d.nodeId) console.log(`Node: ${d.nodeId}`)
        if (d.output) console.log(`\n${chalk.white(d.output)}`)
        if (d.error) console.log(chalk.red(`Error: ${d.error}`))
      } catch (err: any) {
        const msg = err?.response?.data?.error || err?.message || String(err)
        console.error(chalk.red(`✗ ${msg}`))
        process.exit(1)
      }
    })

  // jackclaw task list
  task
    .command('list')
    .description('List recent tasks')
    .option('--node <nodeId>', 'Filter by node')
    .option('--limit <n>', 'Max results', parseInt)
    .option('--json', 'Output raw JSON')
    .action(async (opts: { node?: string; limit?: number; json?: boolean }) => {
      const { hubUrl, token } = getHubBase()

      try {
        const params: Record<string, string> = {}
        if (opts.node) params.nodeId = opts.node
        if (opts.limit) params.limit = String(opts.limit)

        const res = await axios.get(`${hubUrl}/api/tasks/list`, {
          headers: hubHeaders(token),
          params,
          timeout: 10000,
        })

        if (opts.json) {
          console.log(JSON.stringify(res.data, null, 2))
          return
        }

        const tasks = res.data.tasks ?? []
        if (!tasks.length) {
          console.log(chalk.gray('No tasks found.'))
          return
        }

        for (const t of tasks) {
          const age = Math.round((Date.now() - t.submittedAt) / 1000)
          const statusStr = {
            completed: chalk.green('✓'),
            failed: chalk.red('✗'),
            cancelled: chalk.gray('⊘'),
            running: chalk.yellow('…'),
            pending: chalk.blue('○'),
          }[t.status as string] ?? '?'

          console.log(
            `${statusStr} ${chalk.bold(t.id.slice(0, 8))}  ${chalk.cyan(t.type.padEnd(10))}  ` +
            `${chalk.gray(t.prompt.slice(0, 50).padEnd(50))}  ` +
            `${chalk.gray(age + 's ago')}  node:${t.nodeId?.slice(0, 8) ?? '?'}`,
          )
        }
      } catch (err: any) {
        const msg = err?.response?.data?.error || err?.message || String(err)
        console.error(chalk.red(`✗ ${msg}`))
        process.exit(1)
      }
    })

  // jackclaw task cancel <id>
  task
    .command('cancel <id>')
    .description('Cancel a running task')
    .action(async (id: string) => {
      const { hubUrl, token } = getHubBase()

      try {
        const res = await axios.post(`${hubUrl}/api/tasks/${id}/cancel`, {}, {
          headers: hubHeaders(token),
          timeout: 10000,
        })
        console.log(chalk.green(`✓ Task ${id} cancelled`), res.data)
      } catch (err: any) {
        const msg = err?.response?.data?.error || err?.message || String(err)
        console.error(chalk.red(`✗ ${msg}`))
        process.exit(1)
      }
    })
}

/**
 * jackclaw ask '<question>'  — shortcut for task run --type chat
 */
export function registerTaskAsk(program: Command): void {
  program
    .command('ask <prompt>')
    .description('Quick chat with any available node (alias for: task run --type chat)')
    .option('--node <nodeId>', 'Target a specific node')
    .option('--model <model>', 'Model override')
    .option('--json', 'Output raw JSON')
    .action(async (prompt: string, opts: { node?: string; model?: string; json?: boolean }) => {
      const { hubUrl, token } = getHubBase()

      console.log(chalk.gray('Asking...'))

      try {
        const res = await axios.post(`${hubUrl}/api/tasks/submit`, {
          type: 'chat',
          prompt,
          nodeId: opts.node,
          model: opts.model,
        }, {
          headers: hubHeaders(token),
          timeout: 130000,
        })

        if (opts.json) {
          console.log(JSON.stringify(res.data, null, 2))
          return
        }

        const d = res.data
        console.log('')
        if (d.output) console.log(chalk.white(d.output))
        else if (d.error) console.log(chalk.red(`Error: ${d.error}`))

        if (d.model) console.log(chalk.gray(`\n↳ model: ${d.model}`))
        if (d.tokenUsage) {
          console.log(chalk.gray(`  tokens: in=${d.tokenUsage.input} out=${d.tokenUsage.output}`))
        }
      } catch (err: any) {
        const msg = err?.response?.data?.error || err?.message || String(err)
        console.error(chalk.red(`✗ ${msg}`))
        process.exit(1)
      }
    })
}
