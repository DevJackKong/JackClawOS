# JackClaw Quick Start 🦞

> From zero to your AI company in 5 minutes.

## Option 1: Try the Demo (30 seconds)

```bash
npx @jackclaw/cli@latest demo
```

This starts a Hub + registers a CEO + 3 AI employees, runs a simulated workday with reports and chat.

## Option 2: Create Your Own Node (2 minutes)

```bash
# Scaffold a new project
npx @jackclaw/create@latest my-ai-team
cd my-ai-team
npm install

# Start your node
npx jackclaw start
```

### Interactive scaffolding options

| Option | Choices | Default |
|--------|---------|---------|
| Project name | any | `my-jackclaw-node` |
| Node role | worker / engineer / analyst / ceo | worker |
| LLM provider | openai / anthropic / ollama / custom | openai |

### Non-interactive mode

```bash
npx @jackclaw/create@latest my-node --role engineer --provider ollama --yes
```

## Option 3: Full Monorepo Setup (5 minutes)

```bash
git clone https://github.com/DevJackKong/JackClawOS.git
cd JackClawOS
npm install
npm run build

# Run the demo
npx jackclaw demo

# Or start Hub manually
HUB_PORT=3100 node packages/hub/dist/index.js
```

## Architecture

```
You (CEO)
  ↓ jackclaw CLI
Hub (:3100)  ←→  Node (Alice)  ←→  LLM (GPT-4o / Claude / Ollama)
  ↕               ↕
Dashboard      Node (Bob)
  ↕
Node (Carol)
```

## Key Commands

```bash
# Hub management
jackclaw start              # Start Hub + Node
jackclaw stop               # Stop all
jackclaw status             # Show running processes

# Communication
jackclaw chat --to alice    # Chat with a node
jackclaw send "hello" alice # Quick message
jackclaw inbox              # Check messages

# Monitoring
jackclaw hub-status         # Hub health + metrics
jackclaw nodes              # List registered nodes
jackclaw report             # Submit a report
```

## API Endpoints

Once Hub is running on `:3100`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/health/detailed` | GET | System info + stats |
| `/health/metrics` | GET | Prometheus metrics |
| `/api/register` | POST | Register a node |
| `/api/nodes` | GET | List nodes (JWT) |
| `/api/chat/send` | POST | Send message |
| `/api/chat/inbox` | GET | Pull offline messages |
| `/api/plugins` | GET | List plugins + stats |
| `/api/summary` | GET | Daily summary |
| `/.well-known/agents.json` | GET | Agent Card discovery |
| `/chat/ws` | WS | Realtime WebSocket |

## Configuration

### Environment Variables

```bash
# Hub
HUB_PORT=3100
JWT_SECRET=your-secret-here

# Node
JACKCLAW_HUB_URL=http://localhost:3100
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

### Declarative Config (jackclaw.yaml)

```yaml
hub:
  port: 3100
  secret: my-secret

nodes:
  - name: Alice
    role: engineer
    provider: openai
    model: gpt-4o

  - name: Bob
    role: designer
    provider: anthropic
    model: claude-sonnet-4-20250514

  - name: Carol
    role: analyst
    provider: ollama
    model: llama3
```

## Plugin Development

```typescript
import { definePlugin } from '@jackclaw/sdk'

export default definePlugin({
  name: 'my-plugin',
  version: '0.1.0',

  commands: {
    hello: async (ctx) => {
      return { text: `Hello from ${ctx.node.name}!` }
    },
  },

  events: {
    'message:send': async (ctx, event) => {
      ctx.log(`Message sent to ${event.to}`)
    },
  },

  schedules: {
    morningReport: {
      cron: '0 9 * * *',
      handler: async (ctx) => {
        await ctx.report({ summary: 'Good morning!' })
      },
    },
  },
})
```

## OpenClaw Integration

JackClaw works as an OpenClaw plugin:

```bash
# In your OpenClaw config
npx jackclaw start --openclaw
```

This bridges your OpenClaw agent with JackClaw's multi-agent collaboration.

## Packages

| Package | Description |
|---------|-------------|
| `@jackclaw/cli` | CLI tool |
| `@jackclaw/hub` | Central orchestrator |
| `@jackclaw/node` | AI agent worker |
| `@jackclaw/protocol` | Encrypted messaging |
| `@jackclaw/sdk` | Plugin SDK |
| `@jackclaw/llm-gateway` | Multi-model LLM gateway |
| `@jackclaw/memory` | 4-layer agent memory |
| `@jackclaw/watchdog` | Security monitoring |
| `@jackclaw/openclaw-plugin` | OpenClaw integration |
| `@jackclaw/create` | Project scaffolding |
| `@jackclaw/tunnel` | HTTPS tunneling |
| `@jackclaw/harness` | Agent testing |
| `@jackclaw/payment-vault` | Payment compliance |

## Links

- **GitHub**: https://github.com/DevJackKong/JackClawOS
- **npm**: https://www.npmjs.com/org/jackclaw
- **License**: MIT

---

**Built by [Jack](https://github.com/DevJackKong) 🦞**

*One person. Fifty AI agents. That's JackClaw.*
