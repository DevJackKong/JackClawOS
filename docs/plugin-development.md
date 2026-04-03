# JackClaw Plugin Development Guide

> Build your first plugin in 5 minutes. Ship team automation that actually runs.

---

## Table of Contents

1. [5-Minute Quick Start](#quick-start)
2. [SDK API Reference](#sdk-api-reference)
3. [Plugin Examples](#plugin-examples)
4. [Debugging Guide](#debugging-guide)

---

## Quick Start

### Prerequisites

- Node.js ≥ 20
- A running JackClaw node (`jackclaw node start`)

### Step 1: Scaffold

```bash
npx create-jackclaw my-first-plugin
cd my-first-plugin
```

Select **Plugin** when prompted.

### Step 2: Edit `src/index.ts`

```typescript
import { definePlugin } from '@jackclaw/sdk'

export default definePlugin({
  name: 'my-first-plugin',
  version: '1.0.0',

  commands: {
    greet: async (ctx) => {
      const name = ctx.args[0] ?? 'stranger'
      return { text: `Hey ${name}, greetings from ${ctx.node.name}! 👋` }
    },
  },
})
```

### Step 3: Build & Load

```bash
npm run build
jackclaw plugin load .
```

### Step 4: Test

In any channel connected to your node:

```
/greet World
# → Hey World, greetings from my-node! 👋
```

**You're done.** That's a working JackClaw plugin.

---

## SDK API Reference

### `definePlugin(definition)`

Registers a plugin. The JackClaw runtime picks up the default export.

```typescript
import { definePlugin } from '@jackclaw/sdk'

export default definePlugin({
  name: string            // required — unique plugin identifier
  version: string         // required — semver string
  description?: string    // shown in /plugins list
  commands?: Record<string, CommandHandler>
  schedule?: ScheduleDefinition
  hooks?: HooksDefinition
})
```

### `defineNode(definition)`

Like `definePlugin` but for standalone nodes. Adds `capabilities` field.

```typescript
import { defineNode } from '@jackclaw/sdk'

export default defineNode({
  ...pluginFields,
  capabilities?: string[]  // e.g. ['report', 'command', 'schedule']
})
```

---

### CommandHandler

```typescript
type CommandHandler = (ctx: CommandContext) => Promise<CommandResult | void>
```

#### `CommandContext`

| Field | Type | Description |
|-------|------|-------------|
| `node` | `NodeInfo` | Node this plugin runs on |
| `plugin` | `PluginInfo` | This plugin's metadata |
| `args` | `string[]` | Space-separated tokens after the command |
| `input` | `string` | Full raw input string |
| `userId` | `string?` | Caller's user ID |
| `userName` | `string?` | Caller's display name |
| `log` | `Logger` | Scoped logger |
| `store` | `PluginStore` | Persistent key-value store |

#### `CommandResult`

| Field | Type | Description |
|-------|------|-------------|
| `text` | `string?` | Plain text reply |
| `markdown` | `string?` | Markdown reply |
| `data` | `object?` | Structured data (attached to message) |
| `items` | `Array<{label, value}>?` | Rendered as a table/list |

---

### ScheduleDefinition

```typescript
schedule: {
  daily?: ScheduleHandler      // 09:00 local time every day
  hourly?: ScheduleHandler     // top of every hour
  minutely?: ScheduleHandler   // every minute (use sparingly)
  cron?: {
    [expression: string]: ScheduleHandler  // e.g. "0 9 * * 1"
  }
}
```

#### `ScheduleContext`

All fields from `CommandContext` (minus `args`/`input`/`userId`/`userName`) plus:

| Field | Type | Description |
|-------|------|-------------|
| `report(payload)` | `async fn` | Send structured report to channel |
| `notify(text)` | `async fn` | Send plain text notification |

#### `ReportPayload`

```typescript
{
  summary: string
  items?: Array<{ label: string; value: string | number | boolean }>
  data?: Record<string, unknown>
}
```

---

### HooksDefinition

```typescript
hooks: {
  onLoad?: HookHandler        // called when plugin is loaded
  onShutdown?: HookHandler    // called on graceful shutdown
  onError?: (err: Error, ctx: HookContext) => Promise<void>
}
```

---

### PluginStore

Persistent key-value store per plugin, survives restarts.

```typescript
store.get<T>(key: string): T | undefined
store.set(key: string, value: unknown): void
store.delete(key: string): void
store.clear(): void
```

---

### Logger

```typescript
ctx.log.debug('message', ...args)
ctx.log.info('message', ...args)
ctx.log.warn('message', ...args)
ctx.log.error('message', ...args)
```

---

### Testing Utilities

```typescript
import { createMockCommandContext, createMockScheduleContext } from '@jackclaw/sdk'

const ctx = createMockCommandContext({ args: ['Alice'] })
const result = await myPlugin.commands!.greet!(ctx)
assert.strictEqual(result?.text, 'Hey Alice, greetings from test-node!')
```

---

## Plugin Examples

### 1. Weather Report

Fetch and report today's weather via wttr.in.

```typescript
import { definePlugin } from '@jackclaw/sdk'

export default definePlugin({
  name: 'weather-report',
  version: '1.0.0',

  commands: {
    weather: async (ctx) => {
      const city = ctx.args.join('+') || 'Shanghai'
      const res = await fetch(`https://wttr.in/${city}?format=3`)
      const text = await res.text()
      return { text: text.trim() }
    },
  },

  schedule: {
    daily: async (ctx) => {
      const res = await fetch('https://wttr.in/Shanghai?format=3')
      const weather = await res.text()
      await ctx.report({
        summary: `☀️ Morning Weather: ${weather.trim()}`,
      })
    },
  },
})
```

---

### 2. GitHub PR Status

Post open PRs from your repos every morning.

```typescript
import { definePlugin } from '@jackclaw/sdk'

const GITHUB_TOKEN = process.env.GITHUB_TOKEN!
const REPO = process.env.GITHUB_REPO ?? 'org/repo'

async function fetchOpenPRs() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/pulls`, {
    headers: { Authorization: `token ${GITHUB_TOKEN}` },
  })
  return res.json() as Promise<Array<{ title: string; number: number; user: { login: string } }>>
}

export default definePlugin({
  name: 'github-pr-status',
  version: '1.0.0',

  commands: {
    prs: async (ctx) => {
      const prs = await fetchOpenPRs()
      if (!prs.length) return { text: '✅ No open PRs' }
      const lines = prs.map((p) => `#${p.number} ${p.title} — @${p.user.login}`)
      return { text: `Open PRs (${prs.length}):\n${lines.join('\n')}` }
    },
  },

  schedule: {
    daily: async (ctx) => {
      const prs = await fetchOpenPRs()
      await ctx.report({
        summary: `📋 Open PRs: ${prs.length}`,
        items: prs.map((p) => ({ label: `#${p.number}`, value: p.title })),
      })
    },
  },
})
```

---

### 3. Finance / Exchange Rate

Daily CNY/USD rate summary.

```typescript
import { definePlugin } from '@jackclaw/sdk'

export default definePlugin({
  name: 'forex-report',
  version: '1.0.0',

  commands: {
    rate: async (ctx) => {
      const pair = ctx.args[0]?.toUpperCase() ?? 'USD'
      const res = await fetch(`https://open.er-api.com/v6/latest/CNY`)
      const data = await res.json() as { rates: Record<string, number> }
      const rate = data.rates[pair]
      return rate
        ? { text: `1 CNY = ${rate.toFixed(4)} ${pair}` }
        : { text: `Unknown currency: ${pair}` }
    },
  },

  schedule: {
    daily: async (ctx) => {
      const res = await fetch('https://open.er-api.com/v6/latest/CNY')
      const data = await res.json() as { rates: Record<string, number> }
      await ctx.report({
        summary: '💱 Daily Exchange Rates (CNY base)',
        items: ['USD', 'EUR', 'JPY', 'HKD'].map((c) => ({
          label: c,
          value: data.rates[c]?.toFixed(4) ?? 'N/A',
        })),
      })
    },
  },
})
```

---

### 4. System Health Monitor

Report CPU, memory, and disk.

```typescript
import { definePlugin } from '@jackclaw/sdk'
import os from 'os'

function memGB(bytes: number) {
  return (bytes / 1024 ** 3).toFixed(2) + ' GB'
}

export default definePlugin({
  name: 'system-health',
  version: '1.0.0',

  commands: {
    health: async (ctx) => {
      const freeMem = os.freemem()
      const totalMem = os.totalmem()
      const uptime = Math.floor(os.uptime() / 3600)
      return {
        text: `🖥 ${ctx.node.name}`,
        items: [
          { label: 'Memory', value: `${memGB(freeMem)} free / ${memGB(totalMem)}` },
          { label: 'Uptime', value: `${uptime}h` },
          { label: 'CPUs', value: os.cpus().length },
          { label: 'Platform', value: os.platform() },
        ],
      }
    },
  },

  schedule: {
    hourly: async (ctx) => {
      const usedMem = os.totalmem() - os.freemem()
      const pct = ((usedMem / os.totalmem()) * 100).toFixed(0)
      if (Number(pct) > 90) {
        await ctx.notify(`⚠️ High memory usage on ${ctx.node.name}: ${pct}%`)
      }
    },
  },
})
```

---

### 5. Daily Standup Collector

Collect standup notes and post a summary.

```typescript
import { definePlugin } from '@jackclaw/sdk'

export default definePlugin({
  name: 'standup',
  version: '1.0.0',

  commands: {
    standup: async (ctx) => {
      const note = ctx.args.join(' ')
      if (!note) return { text: 'Usage: /standup <your update>' }
      const key = `standup:${ctx.userId}:${new Date().toDateString()}`
      ctx.store.set(key, { user: ctx.userName, note, ts: Date.now() })
      return { text: `✅ Standup noted, ${ctx.userName}!` }
    },

    summary: async (ctx) => {
      const prefix = `standup:`
      const today = new Date().toDateString()
      const entries: Array<{ user: string; note: string }> = []
      // In a real impl, store.keys() would be exposed; this is illustrative
      return {
        text: entries.length
          ? entries.map((e) => `**${e.user}**: ${e.note}`).join('\n')
          : 'No standups recorded yet today.',
      }
    },
  },

  schedule: {
    daily: async (ctx) => {
      await ctx.notify('🌅 Time for your standup! Use /standup <update>')
    },
  },
})
```

---

### 6. Deployment Notifier

Notify the team when a deploy completes.

```typescript
import { definePlugin } from '@jackclaw/sdk'
import { execSync } from 'child_process'

export default definePlugin({
  name: 'deploy-notifier',
  version: '1.0.0',

  commands: {
    deploy: async (ctx) => {
      const env = ctx.args[0] ?? 'staging'
      await ctx.store.set('lastDeploy', { env, ts: Date.now(), by: ctx.userName })
      // Trigger your deploy script
      // execSync(`./deploy.sh ${env}`)
      return { text: `🚀 Deploy to **${env}** triggered by ${ctx.userName}` }
    },

    'deploy-status': async (ctx) => {
      const last = ctx.store.get<{ env: string; ts: number; by: string }>('lastDeploy')
      if (!last) return { text: 'No deploys recorded.' }
      const ago = Math.floor((Date.now() - last.ts) / 60000)
      return { text: `Last deploy: ${last.env} — ${ago}m ago by ${last.by}` }
    },
  },
})
```

---

### 7. Todo List

Shared team todo list per node.

```typescript
import { definePlugin } from '@jackclaw/sdk'

interface Todo { id: number; text: string; done: boolean; owner: string }

export default definePlugin({
  name: 'todo',
  version: '1.0.0',

  commands: {
    'todo-add': async (ctx) => {
      const todos = ctx.store.get<Todo[]>('todos') ?? []
      const todo: Todo = { id: Date.now(), text: ctx.args.join(' '), done: false, owner: ctx.userName ?? 'anon' }
      ctx.store.set('todos', [...todos, todo])
      return { text: `✅ Added: ${todo.text}` }
    },

    'todo-list': async (ctx) => {
      const todos = ctx.store.get<Todo[]>('todos') ?? []
      const open = todos.filter((t) => !t.done)
      if (!open.length) return { text: '🎉 No open todos!' }
      return {
        text: 'Open todos:',
        items: open.map((t) => ({ label: `#${t.id}`, value: t.text })),
      }
    },

    'todo-done': async (ctx) => {
      const id = Number(ctx.args[0])
      const todos = ctx.store.get<Todo[]>('todos') ?? []
      const updated = todos.map((t) => t.id === id ? { ...t, done: true } : t)
      ctx.store.set('todos', updated)
      return { text: `✔ Marked #${id} as done` }
    },
  },
})
```

---

### 8. Hacker News Digest

Top 5 HN stories every morning.

```typescript
import { definePlugin } from '@jackclaw/sdk'

async function topStories() {
  const ids = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json')
    .then((r) => r.json()) as number[]
  const stories = await Promise.all(
    ids.slice(0, 5).map((id) =>
      fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then((r) => r.json())
    )
  )
  return stories as Array<{ title: string; url?: string; score: number }>
}

export default definePlugin({
  name: 'hn-digest',
  version: '1.0.0',

  commands: {
    hn: async (ctx) => {
      const stories = await topStories()
      return {
        text: '📰 Hacker News Top 5',
        items: stories.map((s) => ({ label: `▲${s.score}`, value: s.title })),
      }
    },
  },

  schedule: {
    daily: async (ctx) => {
      const stories = await topStories()
      await ctx.report({
        summary: '📰 HN Morning Digest',
        items: stories.map((s) => ({ label: `▲${s.score}`, value: s.title })),
      })
    },
  },
})
```

---

### 9. Uptime Monitor

Ping URLs and alert if any go down.

```typescript
import { definePlugin } from '@jackclaw/sdk'

const URLS = (process.env.MONITOR_URLS ?? '').split(',').filter(Boolean)

async function check(url: string): Promise<{ url: string; ok: boolean; ms: number }> {
  const start = Date.now()
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    return { url, ok: res.ok, ms: Date.now() - start }
  } catch {
    return { url, ok: false, ms: Date.now() - start }
  }
}

export default definePlugin({
  name: 'uptime-monitor',
  version: '1.0.0',

  commands: {
    uptime: async (ctx) => {
      const results = await Promise.all(URLS.map(check))
      return {
        items: results.map((r) => ({
          label: r.url,
          value: r.ok ? `✅ ${r.ms}ms` : '❌ DOWN',
        })),
      }
    },
  },

  schedule: {
    minutely: async (ctx) => {
      const results = await Promise.all(URLS.map(check))
      const down = results.filter((r) => !r.ok)
      if (down.length) {
        await ctx.notify(
          `🚨 DOWN: ${down.map((r) => r.url).join(', ')}`
        )
      }
    },
  },
})
```

---

### 10. AI Code Review Notifier

Summarize new PRs with an AI comment prompt.

```typescript
import { definePlugin } from '@jackclaw/sdk'

const GITHUB_TOKEN = process.env.GITHUB_TOKEN!
const REPO = process.env.GITHUB_REPO ?? 'org/repo'

export default definePlugin({
  name: 'ai-code-review',
  version: '1.0.0',

  schedule: {
    cron: {
      // Check every 30 minutes
      '*/30 * * * *': async (ctx) => {
        const res = await fetch(`https://api.github.com/repos/${REPO}/pulls?state=open&per_page=5`, {
          headers: { Authorization: `token ${GITHUB_TOKEN}` },
        })
        const prs = await res.json() as Array<{ number: number; title: string; created_at: string }>
        const lastCheck = ctx.store.get<number>('lastCheck') ?? 0
        const newPRs = prs.filter((p) => new Date(p.created_at).getTime() > lastCheck)

        if (newPRs.length) {
          await ctx.notify(
            `🤖 New PR${newPRs.length > 1 ? 's' : ''} need review:\n` +
            newPRs.map((p) => `• #${p.number} ${p.title}`).join('\n')
          )
        }

        ctx.store.set('lastCheck', Date.now())
      },
    },
  },
})
```

---

## Debugging Guide

### Enable verbose logging

```bash
JACKCLAW_LOG_LEVEL=debug jackclaw node start
```

### Inspect loaded plugins

```bash
jackclaw plugin list
jackclaw plugin status my-plugin
```

### Reload a plugin without restart

```bash
jackclaw plugin reload my-plugin
```

### Test a command locally

```typescript
// test/my-plugin.test.ts
import { createMockCommandContext } from '@jackclaw/sdk'
import plugin from '../src/index.js'

const ctx = createMockCommandContext({ args: ['Alice'] })
const result = await plugin.commands!.greet!(ctx)
console.log(result) // { text: 'Hey Alice, greetings from test-node! 👋' }
```

### Common errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Plugin name is required` | Missing `name` in `definePlugin` | Add `name` field |
| `Cannot find module '@jackclaw/sdk'` | SDK not installed | `npm install @jackclaw/sdk` |
| `Command not found` | Build not run | `npm run build` |
| `store.get undefined` | Key not set yet | Check with `?? defaultValue` |

### Logs location

```bash
# macOS / Linux
~/.jackclaw/logs/node-<id>.log

# Docker
docker logs jackclaw-node
```

### Watch mode development loop

```bash
# Terminal 1 — rebuild on save
npm run dev

# Terminal 2 — reload plugin on rebuild
jackclaw plugin watch my-plugin
```

---

*Full SDK source: [packages/jackclaw-sdk/src/index.ts](../packages/jackclaw-sdk/src/index.ts)*
