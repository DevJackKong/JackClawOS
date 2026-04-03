# JackClaw Quick Start

> 3 steps to run your AI company 🦞

[![Build](https://github.com/DevJackKong/JackClawOS/actions/workflows/ci.yml/badge.svg)](https://github.com/DevJackKong/JackClawOS/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

## Prerequisites / 前置要求

- Node.js >= 20
- npm >= 10

## 1. Clone & Build / 克隆并构建

```bash
git clone https://github.com/DevJackKong/JackClawOS.git
cd JackClawOS
npm install
npm run build
```

## 2. Start Hub + Node / 启动服务

```bash
npx jackclaw start
```

Expected output / 预期输出:
```
[hub] JackClaw Hub listening on http://localhost:3100
[hub] Routes:
  POST /api/register     - Node registration
  POST /api/report       - Receive agent report
  GET  /api/nodes        - List nodes
  ...
✅ Hub ready — http://localhost:3100

🦞 JackClaw Node starting...
[node] Node ID: node-a1b2c3d4
[hub] Registered with Hub. Status: 201
✅ Node ready — http://localhost:19000

All services running. Ctrl+C to stop.
```

## 3. Send Your First Message / 发送第一条消息

### Register a node / 注册节点

```bash
# Register and get a JWT token
TOKEN=$(curl -s -X POST http://localhost:3100/api/register \
  -H 'Content-Type: application/json' \
  -d '{"nodeId":"my-agent","name":"My Agent","role":"engineer","publicKey":"test"}' \
  | jq -r '.token')

echo "Token: $TOKEN"
```

### Check node status / 查看节点状态 (CEO role required)

```bash
# Register as CEO first
CEO_TOKEN=$(curl -s -X POST http://localhost:3100/api/register \
  -H 'Content-Type: application/json' \
  -d '{"nodeId":"ceo","name":"CEO","role":"ceo","publicKey":"test"}' \
  | jq -r '.token')

# List all nodes
curl -s http://localhost:3100/api/nodes \
  -H "Authorization: Bearer $CEO_TOKEN" | jq
```

### Send a chat message / 发送聊天消息

```bash
curl -s -X POST http://localhost:3100/api/chat/send \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "id": "msg-001",
    "from": "my-agent",
    "to": "ceo",
    "content": "Login page is done. Starting auth API.",
    "type": "text",
    "ts": '$(date +%s000)',
    "signature": "",
    "encrypted": false
  }' | jq
```

### Submit a daily report / 提交日报

```bash
curl -s -X POST http://localhost:3100/api/report \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "summary": "Completed login page (3h). Auth API 50% done.",
    "period": "daily",
    "visibility": "ceo"
  }' | jq
```

## Connect to OpenClaw / 连接 OpenClaw

Add to your `openclaw.yaml`:

```yaml
plugins:
  entries:
    jackclaw:
      path: ./packages/openclaw-plugin
      config:
        hubUrl: http://localhost:3100
```

Then use in any OpenClaw channel:
- `/jackclaw status` — Node online status
- `/jackclaw report` — Today's team summary
- Say "团队汇报" or "节点状态" in natural language

## Architecture / 架构

```
┌─────────────┐
│   CEO (You)  │  Human — makes decisions, sets direction
└──────┬───────┘
       │ JWT Auth
┌──────▼───────┐
│     Hub      │  Central coordinator — routes messages,
│  :3100       │  stores reports, manages trust
└──┬───┬───┬───┘
   │   │   │     WebSocket + REST
┌──▼┐ ┌▼──┐ ┌▼──┐
│ N1 │ │ N2 │ │ N3 │  Agent Nodes — each is an OpenClaw agent
│:19k│ │:19k│ │:19k│  with its own memory, skills, and identity
└────┘ └────┘ └────┘
```

**CEO** = You (human). All high-risk decisions require your approval.
**Hub** = HQ. Routes messages, aggregates reports, manages trust graph.
**Node** = AI employee. Each node is a full OpenClaw agent with RSA identity.

## Configuration / 配置

Node config is at `~/.jackclaw/config.json`:

```json
{
  "hubUrl": "http://localhost:3100",
  "port": 19000,
  "nodeName": "engineer-alice",
  "nodeRole": "engineer",
  "reportCron": "0 8 * * *",
  "visibility": {
    "shareMemory": true,
    "shareTasks": true
  }
}
```

## Run E2E Tests / 运行测试

```bash
node tests/e2e.js
```

45 assertions covering: registration, auth, node listing, reports, chat, directory, collaboration.

## What's Next / 下一步

- `npm create jackclaw@latest my-team` — Scaffold a new team (coming soon)
- Dashboard at `http://localhost:3100` (coming soon)
- Multi-hub federation (roadmap)

---

[Full README](README.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)
