# JackClaw

## What makes JackClaw different

1. **Human-in-the-Loop by design** — Every high-stakes action (payments, deployments, deletions) requires cryptographic human approval via HMAC tokens. AI agents can never bypass the human gate.
2. **Jurisdiction-aware compliance engine** — Built-in multi-region payment rules (CN/EU/US/HK/SG) with auto-approve thresholds, KYC requirements, and daily limits — not bolted on, but core to the protocol.
3. **Isolated security domains** — Watchdog, Payment Vault, and Memory operate in separate storage with append-only audit logs (chmod 444). Compromising one domain cannot affect others.
4. **End-to-end encrypted agent mesh** — All inter-node communication uses RSA-2048 + AES-256-GCM hybrid encryption with signed messages. The Hub never sees plaintext agent data.
5. **Zero-trust agent architecture** — Trust scores, autonomy levels (L0-L3), and supervision policies are enforced at the protocol layer. No agent gets implicit trust.

> 让每一位 CEO 都能通过 AI 做得更好，推动人类文明到达新的高度。

**分布式 AI 组织协作框架** — 基于 OpenClaw 生态，完全开源。

JackClaw 是一个平台，不是一个产品。我们欢迎所有人在这个框架上构建自己的 Agent 网络、行业插件和扩展能力。你的贡献让这个框架对每个人都更有价值。

**灵感来源：** OpenClaw · Claude Code · 开源社区

## Structure

```
jackclaw/
├── package.json          # npm workspaces root
└── packages/
    ├── protocol/         # E2E crypto + message format
    └── node/             # Node agent (HTTP server + cron reporter)
```

## Quick Start

```bash
# Install all dependencies
npm install

# Build all packages
npm run build

# Run the node agent
npm run dev:node
```

## Packages

### `@jackclaw/protocol`
End-to-end encrypted messaging protocol.
- RSA-2048 key pairs (OAEP + SHA-256)
- AES-256-GCM hybrid encryption
- RSA-SHA256 message signing
- Full TypeScript + unit tests

### `@jackclaw/node`
Node agent that:
- Generates and persists a stable identity (`~/.jackclaw/identity.json`)
- Registers with a Hub server
- Sends encrypted daily reports (cron, default 08:00)
- Receives and processes tasks from Hub
- Exposes REST API on port 19000

## Configuration

Edit `~/.jackclaw/config.json` (auto-created on first run):

```json
{
  "hubUrl": "http://localhost:18999",
  "port": 19000,
  "reportCron": "0 8 * * *",
  "workspaceDir": "~/.openclaw/workspace",
  "hubPublicKey": "-----BEGIN RSA PUBLIC KEY-----\n...",
  "visibility": {
    "shareMemory": true,
    "shareTasks": true,
    "redactPatterns": ["password", "secret"]
  }
}
```
