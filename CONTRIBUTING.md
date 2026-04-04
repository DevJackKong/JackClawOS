# Contributing to JackClaw 🦞

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/DevJackKong/JackClawOS.git
cd JackClawOS
npm install
npm run build
```

## Running Tests

```bash
# Unit tests (all packages)
npx tsx --test packages/protocol/tests/*.test.ts
npx tsx --test packages/hub/tests/*.test.ts
npx tsx --test packages/llm-gateway/tests/*.test.ts
npx tsx --test packages/watchdog/tests/*.test.ts

# E2E tests (starts Hub automatically)
node tests/e2e.js
```

## Project Structure

```
packages/
├── hub/          # Central orchestrator (Express + WebSocket)
├── node/         # AI agent worker
├── protocol/     # Types, crypto, identity
├── cli/          # Command-line tool
├── llm-gateway/  # Multi-model LLM routing
├── memory/       # 4-layer agent memory
├── sdk/          # Plugin development SDK
├── watchdog/     # Security monitoring
├── openclaw-plugin/ # OpenClaw integration
├── create-jackclaw/ # Project scaffolding
├── harness/      # Agent testing framework
├── tunnel/       # HTTPS tunneling
├── payment-vault/# Payment compliance
├── dashboard/    # Web UI (React)
└── pwa/          # Progressive Web App
tests/
└── e2e.js        # End-to-end integration tests
```

## Writing Tests

We use Node's built-in test runner (`node:test` + `node:assert/strict`):

```typescript
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

describe('MyFeature', () => {
  it('does something', () => {
    assert.equal(1 + 1, 2)
  })
})
```

Run with: `npx tsx --test packages/your-package/tests/*.test.ts`

## Commit Convention

```
feat: add new feature
fix: bug fix
test: add or update tests
docs: documentation changes
chore: maintenance (deps, config)
refactor: code restructuring
```

## Pull Request Process

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Write tests for new functionality
4. Ensure all tests pass
5. Submit a PR with a clear description

## Code Style

- TypeScript strict mode
- No external test frameworks (use `node:test`)
- Keep files under ~250 lines
- Branded types for identity (`HumanId`, `AgentHandle`, etc.)
- Plugin system uses EventBus — don't import Hub internals

## Questions?

Open an issue on GitHub or reach out via the project discussions.

---

**License**: MIT
