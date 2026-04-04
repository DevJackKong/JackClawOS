#!/usr/bin/env node

/**
 * create-jackclaw — Scaffold a complete JackClaw node project.
 *
 * Usage:
 *   npm create jackclaw@latest
 *   npx create-jackclaw
 *   npx create-jackclaw --name my-node --role worker --provider openai --yes
 */

import fs from 'fs'
import path from 'path'
import readline from 'readline'

// ─── Banner ──────────────────────────────────────────────────────────────────

const BANNER = `
🦞 create-jackclaw — Scaffold your AI node
───────────────────────────────────────────
`

// ─── CLI arg parsing ─────────────────────────────────────────────────────────

interface CliArgs {
  name?: string
  role?: string
  provider?: string
  yes?: boolean
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {}
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--yes' || a === '-y') {
      args.yes = true
    } else if (a === '--name' && argv[i + 1]) {
      args.name = argv[++i]
    } else if (a === '--role' && argv[i + 1]) {
      args.role = argv[++i]
    } else if (a === '--provider' && argv[i + 1]) {
      args.provider = argv[++i]
    } else if (!a.startsWith('-') && !args.name) {
      // positional: treat as project name
      args.name = a
    }
  }
  return args
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

function ask(rl: readline.Interface, question: string, defaultVal: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(`  ${question} (${defaultVal}): `, answer => {
      resolve(answer.trim() || defaultVal)
    })
  })
}

function askChoice(
  rl: readline.Interface,
  question: string,
  choices: string[],
  defaultVal: string,
): Promise<string> {
  return new Promise(resolve => {
    const choiceStr = choices.map(c => (c === defaultVal ? `[${c}]` : c)).join(' / ')
    rl.question(`  ${question} (${choiceStr}): `, answer => {
      const val = answer.trim().toLowerCase()
      if (val && choices.includes(val)) {
        resolve(val)
      } else {
        resolve(defaultVal)
      }
    })
  })
}

// ─── Validators ──────────────────────────────────────────────────────────────

const ROLES = ['worker', 'engineer', 'analyst', 'ceo'] as const
const PROVIDERS = ['openai', 'anthropic', 'ollama', 'custom'] as const

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

// ─── Templates ───────────────────────────────────────────────────────────────

function genPackageJson(name: string, safeName: string, role: string): string {
  const pkg = {
    name: safeName,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      build: 'tsc',
      dev: 'tsc --watch',
      start: 'npx jackclaw start',
      typecheck: 'tsc --noEmit',
    },
    dependencies: {
      '@jackclaw/node': '^0.2.0',
      '@jackclaw/sdk': '^0.2.0',
    },
    devDependencies: {
      '@types/node': '^20.0.0',
      typescript: '^5.4.0',
    },
    jackclaw: {
      role,
    },
  }
  return JSON.stringify(pkg, null, 2) + '\n'
}

function genTsConfig(): string {
  const config = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      outDir: 'dist',
      rootDir: 'src',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      declaration: true,
      sourceMap: true,
    },
    include: ['src'],
    exclude: ['node_modules', 'dist'],
  }
  return JSON.stringify(config, null, 2) + '\n'
}

function genSrcIndex(name: string, role: string): string {
  return `import { definePlugin } from '@jackclaw/sdk'

/**
 * ${name} — A JackClaw ${role} node plugin.
 *
 * This plugin registers basic commands that your node exposes
 * to the Hub and other nodes in the team.
 *
 * Features:
 *   - /ping, /status, /hello commands
 *   - /cost — LLM usage cost summary
 *   - Daily report schedule
 *   - Event hooks for message tracking
 */
export default definePlugin({
  name: '${name}',
  version: '0.1.0',
  description: 'A ${role} node for JackClaw',

  commands: {
    /**
     * /ping — Simple health check.
     */
    ping: async (ctx) => {
      return { text: \\\`🦞 pong from \\\${ctx.node.name} (role: ${role})\\\` }
    },

    /**
     * /status — Report node status.
     */
    status: async (ctx) => {
      return {
        text: \\\`Node \\\${ctx.node.name} is online\\\`,
        items: [
          { label: 'Role', value: '${role}' },
          { label: 'Version', value: ctx.plugin.version },
          { label: 'Uptime', value: \\\`\\\${Math.floor(process.uptime())}s\\\` },
        ],
      }
    },

    /**
     * /hello <name> — Greet someone.
     */
    hello: async (ctx) => {
      const who = ctx.args[0] || ctx.userName || 'world'
      return { text: \\\`👋 Hello, \\\${who}! I'm \\\${ctx.node.name}.\\\` }
    },

    /**
     * /cost — Show LLM usage cost summary (if gateway available).
     */
    cost: async (ctx) => {
      try {
        const stats = await ctx.hub.get('/api/plugins/stats')
        return {
          text: '💰 LLM Cost Summary',
          items: [
            { label: 'Total calls', value: stats?.totalCalls ?? 'N/A' },
            { label: 'Est. cost', value: stats?.totalCostUSD ? \\\`$\\\${stats.totalCostUSD}\\\` : 'N/A' },
          ],
        }
      } catch {
        return { text: 'Cost tracking not available on this Hub.' }
      }
    },
  },

  events: {
    /**
     * Track outgoing messages for anomaly detection.
     */
    'message:send': async (ctx, event) => {
      ctx.log(\\\`📤 Message sent to \\\${event.to}\\\`)
    },

    /**
     * React to plugin lifecycle.
     */
    'plugin:loaded': async (ctx) => {
      ctx.log(\\\`✅ Plugin \\\${ctx.plugin.name} loaded\\\`)
    },
  },

  schedules: {
    /**
     * Daily report — runs every day at 08:00.
     */
    dailyReport: {
      cron: '0 8 * * *',
      handler: async (ctx) => {
        await ctx.report({
          summary: \\\`Daily report from \\\${ctx.node.name}\\\`,
          items: [
            { label: 'Status', value: 'healthy' },
            { label: 'Tasks completed', value: 0 },
          ],
        })
      },
    },
  },
})
`
}

function genEnvExample(provider: string): string {
  const lines = [
    '# JackClaw Node Configuration',
    '#',
    '# Copy this file to .env and fill in your values.',
    '',
    '# Hub connection',
    'JACKCLAW_HUB_URL=http://localhost:3100',
    '',
    '# LLM Provider',
    `LLM_PROVIDER=${provider}`,
    '',
  ]

  if (provider === 'openai') {
    lines.push('OPENAI_API_KEY=sk-...')
    lines.push('OPENAI_MODEL=gpt-4o')
  } else if (provider === 'anthropic') {
    lines.push('ANTHROPIC_API_KEY=sk-ant-...')
    lines.push('ANTHROPIC_MODEL=claude-sonnet-4-20250514')
  } else if (provider === 'ollama') {
    lines.push('OLLAMA_HOST=http://localhost:11434')
    lines.push('OLLAMA_MODEL=llama3')
  } else {
    lines.push('# Configure your custom LLM provider')
    lines.push('LLM_API_BASE=http://localhost:8000')
    lines.push('LLM_API_KEY=')
    lines.push('LLM_MODEL=')
  }

  lines.push('')
  return lines.join('\n')
}

function genReadme(name: string, role: string, provider: string): string {
  return `# ${name}

> A **${role}** node for [JackClaw](https://github.com/nicepkg/JackClawOS) 🦞

## Quick Start

\`\`\`bash
# Install dependencies
npm install

# Start the node
npx jackclaw start
\`\`\`

## Configuration

1. Copy \`.env.example\` to \`.env\` and fill in your API keys.
2. The node connects to a JackClaw Hub at \`JACKCLAW_HUB_URL\`.

## Plugin Commands

| Command   | Description          |
|-----------|----------------------|
| \`/ping\`   | Health check         |
| \`/status\` | Report node status   |
| \`/hello\`  | Greet someone        |

## Project Structure

\`\`\`
${name}/
├── src/
│   └── index.ts        # Plugin definition (commands, schedules)
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
\`\`\`

## Development

\`\`\`bash
# Watch mode
npm run dev

# Type check
npm run typecheck

# Build
npm run build
\`\`\`

## LLM Provider: ${provider}

${provider === 'openai' ? 'Set `OPENAI_API_KEY` in your `.env` file.' : ''}${provider === 'anthropic' ? 'Set `ANTHROPIC_API_KEY` in your `.env` file.' : ''}${provider === 'ollama' ? 'Make sure Ollama is running at `http://localhost:11434`.' : ''}${provider === 'custom' ? 'Configure your custom LLM endpoint in `.env`.' : ''}

## Learn More

- [JackClaw Documentation](https://github.com/nicepkg/JackClawOS)
- [Plugin SDK Reference](https://github.com/nicepkg/JackClawOS/tree/main/packages/jackclaw-sdk)
`
}

function genGitignore(): string {
  return `node_modules/
dist/
.env
*.log
.DS_Store
`
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(BANNER)

  const cliArgs = parseArgs(process.argv)
  const skipPrompts = cliArgs.yes === true

  let projectName: string
  let role: string
  let provider: string

  if (skipPrompts) {
    // Non-interactive mode: use defaults for anything not provided
    projectName = cliArgs.name || 'my-jackclaw-node'
    role = cliArgs.role && (ROLES as readonly string[]).includes(cliArgs.role)
      ? cliArgs.role
      : 'worker'
    provider = cliArgs.provider && (PROVIDERS as readonly string[]).includes(cliArgs.provider)
      ? cliArgs.provider
      : 'openai'
  } else {
    // Interactive mode
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    projectName = await ask(rl, 'Project name', cliArgs.name || 'my-jackclaw-node')
    role = await askChoice(rl, 'Node role', [...ROLES], cliArgs.role || 'worker')
    provider = await askChoice(rl, 'LLM provider', [...PROVIDERS], cliArgs.provider || 'openai')

    rl.close()
  }

  const safeName = sanitizeName(projectName)
  const targetDir = path.resolve(process.cwd(), projectName)

  // Check if directory already exists
  if (fs.existsSync(targetDir)) {
    console.error(`\n  ✗ Directory "${projectName}" already exists. Pick a different name.\n`)
    process.exit(1)
  }

  console.log(`\n  📁 Scaffolding ${projectName}...\n`)

  // Create directories
  fs.mkdirSync(path.join(targetDir, 'src'), { recursive: true })

  // Write files
  const files: Array<[string, string]> = [
    ['package.json', genPackageJson(projectName, safeName, role)],
    ['tsconfig.json', genTsConfig()],
    [path.join('src', 'index.ts'), genSrcIndex(projectName, role)],
    ['.env.example', genEnvExample(provider)],
    ['README.md', genReadme(projectName, role, provider)],
    ['.gitignore', genGitignore()],
  ]

  for (const [filePath, content] of files) {
    const fullPath = path.join(targetDir, filePath)
    fs.writeFileSync(fullPath, content, 'utf-8')
    console.log(`  ✔ ${filePath}`)
  }

  // Done!
  console.log(`
  ✅ Project "${projectName}" created successfully!

  Next steps:

    cd ${projectName}
    npm install
    npx jackclaw start

  🦞 Role: ${role} | LLM: ${provider}
  📖 Edit src/index.ts to add commands and schedules.
`)
}

main().catch(err => {
  console.error(`\n  ✗ Error: ${err.message}\n`)
  process.exit(1)
})
