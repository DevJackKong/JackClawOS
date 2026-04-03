/**
 * CLI command: jackclaw providers
 * List available LLM providers across all registered nodes
 */
import { Command } from 'commander'
import chalk from 'chalk'
import axios from 'axios'
import { loadConfig, loadState } from '../config-utils.js'

export function registerProviders(program: Command): void {
  program
    .command('providers')
    .description('List available LLM providers across all nodes')
    .option('--json', 'Output raw JSON')
    .action(async (opts: { json?: boolean }) => {
      const config = loadConfig()
      const state = loadState()
      const hubUrl = config?.hubUrl || process.env.HUB_URL
      const token = state?.token || process.env.HUB_TOKEN

      if (!hubUrl) {
        console.error(chalk.red('✗ Hub URL not configured.'))
        process.exit(1)
      }

      try {
        const res = await axios.get(`${hubUrl}/api/ask/providers`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          timeout: 15000,
        })

        if (opts.json) {
          console.log(JSON.stringify(res.data, null, 2))
          return
        }

        const { nodes } = res.data as { nodes: Record<string, string[]> }
        const entries = Object.entries(nodes)

        if (!entries.length) {
          console.log(chalk.gray('No nodes available.'))
          return
        }

        console.log('')
        console.log(chalk.bold('Available LLM Providers'))
        console.log(chalk.gray('─'.repeat(60)))

        for (const [nodeId, providers] of entries) {
          if (!providers.length) {
            console.log(chalk.cyan(nodeId) + chalk.gray('  (no providers configured)'))
          } else {
            console.log(chalk.cyan(nodeId))
            for (const p of providers) {
              console.log(`  ${chalk.green('•')} ${p}`)
            }
          }
        }
        console.log('')
      } catch (err: any) {
        console.error(chalk.red(`✗ ${err?.response?.data?.error || err?.message}`))
        process.exit(1)
      }
    })
}
