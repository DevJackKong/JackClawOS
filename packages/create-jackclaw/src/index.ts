#!/usr/bin/env node

/**
 * npm create jackclaw my-team
 * 
 * Scaffolds a JackClaw team project with config, docker-compose, and README.
 */

import fs from 'fs'
import path from 'path'
import readline from 'readline'

const BANNER = `
🦞 JackClaw — Create your AI company
─────────────────────────────────────
`

function ask(rl: readline.Interface, question: string, defaultVal: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(`${question} (${defaultVal}): `, answer => {
      resolve(answer.trim() || defaultVal)
    })
  })
}

async function main() {
  console.log(BANNER)

  const dirName = process.argv[2]

  if (!dirName) {
    console.log('Usage: npm create jackclaw <team-name>\n')
    console.log('Example: npm create jackclaw my-team')
    process.exit(1)
  }

  const targetDir = path.resolve(process.cwd(), dirName)

  if (fs.existsSync(targetDir)) {
    console.error(`✗ Directory "${dirName}" already exists.`)
    process.exit(1)
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const teamName = await ask(rl, 'Team name', dirName)
  const nodeName = await ask(rl, 'Your node name', 'my-node')
  const nodeRole = await ask(rl, 'Your role (ceo/engineer/designer)', 'engineer')
  const hubPort = await ask(rl, 'Hub port', '3100')
  const nodePort = await ask(rl, 'Node port', '19000')

  rl.close()

  console.log(`\n📁 Creating ${dirName}...`)
  fs.mkdirSync(targetDir, { recursive: true })

  // jackclaw.config.json
  const config = {
    team: teamName,
    hub: {
      port: parseInt(hubPort),
    },
    node: {
      name: nodeName,
      role: nodeRole,
      port: parseInt(nodePort),
      hubUrl: `http://localhost:${hubPort}`,
    },
    visibility: {
      shareMemory: true,
      shareTasks: true,
    },
    reportCron: '0 8 * * *',
  }
  fs.writeFileSync(
    path.join(targetDir, 'jackclaw.config.json'),
    JSON.stringify(config, null, 2) + '\n',
  )

  // docker-compose.yml
  const dockerCompose = `version: "3.8"

services:
  hub:
    image: node:22-alpine
    working_dir: /app
    command: npx jackclaw start --hub-only --hub-port ${hubPort}
    ports:
      - "${hubPort}:${hubPort}"
    volumes:
      - hub-data:/root/.jackclaw/hub
    environment:
      - NODE_ENV=production

  node:
    image: node:22-alpine
    working_dir: /app
    command: npx jackclaw start --node-only --node-port ${nodePort} --hub-port ${hubPort}
    ports:
      - "${nodePort}:${nodePort}"
    volumes:
      - node-data:/root/.jackclaw
    environment:
      - JACKCLAW_HUB_URL=http://hub:${hubPort}
      - NODE_PORT=${nodePort}
    depends_on:
      - hub

volumes:
  hub-data:
  node-data:
`
  fs.writeFileSync(path.join(targetDir, 'docker-compose.yml'), dockerCompose)

  // README.md
  const readme = `# ${teamName}

> Powered by [JackClaw](https://github.com/DevJackKong/JackClawOS) 🦞

## Quick Start

\`\`\`bash
# Option 1: Docker
docker-compose up

# Option 2: Local
npx jackclaw start
\`\`\`

Hub: http://localhost:${hubPort}
Node: http://localhost:${nodePort}

## Configuration

Edit \`jackclaw.config.json\` to customize your team setup.

## Adding Nodes

Each AI agent runs as a separate Node. Add more by:

\`\`\`bash
# On another machine or terminal
npx jackclaw start --node-only --node-port 19001
\`\`\`

## Architecture

\`\`\`
CEO (You) → Hub (:${hubPort}) → Node (:${nodePort})
                              → Node (:19001)
                              → Node (:19002)
\`\`\`
`
  fs.writeFileSync(path.join(targetDir, 'README.md'), readme)

  // package.json
  const pkg = {
    name: teamName.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
    version: '0.1.0',
    private: true,
    scripts: {
      start: 'npx jackclaw start',
      'start:hub': 'npx jackclaw start --hub-only',
      'start:node': 'npx jackclaw start --node-only',
    },
  }
  fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')

  // .gitignore
  fs.writeFileSync(
    path.join(targetDir, '.gitignore'),
    'node_modules/\n.jackclaw/\n*.log\n',
  )

  // .env
  fs.writeFileSync(
    path.join(targetDir, '.env'),
    `# JackClaw Configuration
HUB_PORT=${hubPort}
NODE_PORT=${nodePort}
# ANTHROPIC_BASE_URL=https://api.anthropic.com
# ANTHROPIC_API_KEY=sk-...
`,
  )

  console.log(`
✅ Done! Your JackClaw team "${teamName}" is ready.

  cd ${dirName}
  npx jackclaw start

🦞 Hub: http://localhost:${hubPort}
🤖 Node: http://localhost:${nodePort}

Next steps:
  1. Edit jackclaw.config.json to customize
  2. Start with: npx jackclaw start
  3. Add more nodes on other machines
  4. Connect to OpenClaw for AI agent integration
`)
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
