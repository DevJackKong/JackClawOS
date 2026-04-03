/**
 * CLI command: jackclaw ask <prompt>
 * Send a prompt to any available LLM via Hub /api/ask
 */
import { Command } from 'commander'
import chalk from 'chalk'
import axios from 'axios'
import { loadConfig, loadState } from '../config-utils.js'

export function registerAsk(program: Command): void {
  program
    .command('ask <prompt>')
    .description('Send a prompt to any LLM via Hub')
    .option('--model <model>', 'Model to use (e.g. qwen-max, claude-sonnet-4-6)')
    .option('--node <nodeId>', 'Target a specific node')
    .option('--json', 'Output raw JSON')
    .action(async (prompt: string, opts: { model?: string; node?: string; json?: boolean }) => {
      const config = loadConfig()
      const state = loadState()

      const hubUrl = config?.hubUrl || process.env.HUB_URL
      const token = state?.token || process.env.HUB_TOKEN

      if (!hubUrl) {
        console.error(chalk.red('✗ Hub URL not configured. Run: jackclaw init or set HUB_URL'))
        process.exit(1)
      }

      const url = opts.node
        ? `${hubUrl}/api/ask/${opts.node}`
        : `${hubUrl}/api/ask`

      try {
        console.log(chalk.gray(`Sending to ${opts.node ? `node:${opts.node}` : 'any available node'}...`))

        const res = await axios.post(url, {
          prompt,
          model: opts.model,
        }, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          timeout: 120000,
        })

        if (opts.json) {
          console.log(JSON.stringify(res.data, null, 2))
          return
        }

        const data = res.data
        console.log('')
        if (data.text) {
          console.log(chalk.white(data.text))
        } else if (data.content) {
          console.log(chalk.white(data.content))
        } else {
          console.log(JSON.stringify(data, null, 2))
        }
        if (data.routedTo) {
          console.log(chalk.gray(`\n↳ via node: ${data.routedTo}`))
        }
        if (data.provider) {
          console.log(chalk.gray(`  provider: ${data.provider}, model: ${data.model}`))
        }
      } catch (err: any) {
        const msg = err?.response?.data?.error || err?.message || String(err)
        const status = err?.response?.status
        if (status === 503) {
          const available = err?.response?.data?.available ?? []
          console.error(chalk.red(`✗ No available node. Registered: ${available.join(', ') || 'none'}`))
        } else {
          console.error(chalk.red(`✗ ${msg}`))
        }
        process.exit(1)
      }
    })
}
