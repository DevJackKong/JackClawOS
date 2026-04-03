# JackClaw

[English](#english) | [中文](#中文)

---

<a id="english"></a>

## English

**A distributed multi-agent collaboration framework with human-in-the-loop oversight.**

JackClaw organizes AI agents into a coordinated mesh — each agent runs as an autonomous Node, all reporting to a central Hub. The Hub acts as the CEO's command center: it aggregates daily reports, routes tasks, brokers collaboration, and enforces compliance. Every high-stakes action (payments, deployments, irreversible operations) requires cryptographic human approval before execution.

### Quick Start

```bash
# Scaffold a new project
npm create jackclaw@latest my-org

# Start the Hub (coordinator)
jackclaw start --role hub

# Start a Node agent
jackclaw start --role node --name "engineer-1"

# Send a task
jackclaw chat --to @engineer-1 --text "Summarize today's commits"
```

**Prerequisites:** Node.js >= 20, npm >= 10

```bash
npm install -g jackclaw
```

### Architecture

```
                         ┌──────────────────────────────────────┐
                         │                 HUB                   │
                         │  Registry · Reports · Memory          │
                         │  Watchdog · Payment · Chat            │
                         │          JWT + RSA-4096 Auth          │
                         └────┬──────────┬──────────┬───────────┘
                              │          │          │
                   ┌──────────▼──┐  ┌────▼─────┐  ┌▼───────────┐
                   │ NODE:backend│  │NODE:front│  │NODE:devops │
                   │ OwnerMemory│  │OwnerMemory│  │OwnerMemory │
                   │ TaskPlanner│  │TaskPlanner│  │TaskPlanner │
                   └─────────────┘  └──────────┘  └────────────┘

          ◄──────── E2E Encrypted (RSA-4096 + AES-256-GCM) ────────►
              Human Approval Gate for: payments · deploys · deletes
```

### Core Modules

| Package | Role | Key Capability |
|---------|------|----------------|
| `@jackclaw/hub` | Central coordinator | Routes messages, aggregates reports, enforces policy |
| `@jackclaw/node` | Agent worker | Registers with Hub, executes tasks, sends daily reports |
| `@jackclaw/protocol` | Encryption layer | RSA + AES-GCM hybrid encryption, message signing |
| `@jackclaw/memory` | 4-layer memory | L1 cache → L2 SQLite → L3 semantic → Hub sync |
| `@jackclaw/harness` | IDE bridge | Connects Claude Code / Codex / Cursor to JackClaw |
| `@jackclaw/watchdog` | Human oversight | Monitoring policies, append-only alerts, human ACK |
| `@jackclaw/payment-vault` | Compliance payments | Multi-jurisdiction rules, auto/human thresholds |
| `@jackclaw/cli` | Management CLI | `jackclaw init/start/chat/status/nodes/invite` |
| `@jackclaw/dashboard` | Web UI | Real-time node status, reports, chat threads |
| `@jackclaw/tunnel` | HTTPS tunnel | Cloudflared secure tunnel |
| `create-jackclaw` | Scaffolding | `npm create jackclaw` project template |

### ClawChat

Real-time messaging layer connecting Nodes, Hub, and humans over WebSocket with JWT auth. Three message types:

| Type | Sender | Purpose |
|------|--------|---------|
| `human` | Human operator | Direct instructions, approvals, overrides |
| `task` | Hub or Node | Assign work, delegate subtasks |
| `ask` | Any agent | Request info, clarification, or review |

All content is E2E encrypted — the Hub relays ciphertext without decrypting.

### OwnerMemory & Privacy

Each Node has a private 4-layer memory store:

| Layer | Scope | Latency |
|-------|-------|---------|
| L1 Hot Cache | In-memory, session | <5ms |
| L2 Persistent | SQLite, node-local | ~10ms |
| L3 Semantic | Indexed, org-wide (opt-in) | ~50ms |
| Hub Sync | Bidirectional, selected | varies |

L1/L2 are private — the Hub cannot read them. L3 is opt-in. Memory access governed by role-based ACL. Nodes teach each other via the **Teaching Protocol**.

### Autonomy Levels

| Level | Label | Allowed |
|-------|-------|---------|
| L0 | Supervised | Read-only; all writes need human approval |
| L1 | Assisted | Query, list, ping; no mutations |
| L2 | Standard | Read + write; no high-stakes |
| L3 | Autonomous | Full access including payments and deploys |

High-stakes actions (`delete`, `deploy`, `payment`, `transfer`, `broadcast`, `terminate`) always require L0 human approval.

### Development

```bash
git clone https://github.com/DevJackKong/JackClawOS.git
cd JackClawOS
npm install
npm run build
npm run dev        # Hub + Node
npm run typecheck  # Type check all packages
npm test           # Run all tests
```

### License

[MIT](LICENSE)

---

<a id="中文"></a>

## 中文

**分布式多 Agent 协作框架，内置人类监督机制。**

JackClaw 将 AI Agent 组织成协调网络——每个 Agent 作为独立 Node 运行，统一向中心 Hub 汇报。Hub 是 CEO 的指挥中心：汇总日报、分发任务、协调协作、执行合规。所有高风险操作（支付、部署、不可逆操作）必须经过密码学人类审批。

### 快速开始

```bash
# 创建新项目
npm create jackclaw@latest my-org

# 启动 Hub（协调中心）
jackclaw start --role hub

# 启动 Node（Agent 节点）
jackclaw start --role node --name "工程师-1"

# 发送任务
jackclaw chat --to @工程师-1 --text "总结今天的提交"
```

**前置要求：** Node.js >= 20, npm >= 10

```bash
npm install -g jackclaw
```

### 架构

```
                         ┌──────────────────────────────────────┐
                         │                 HUB                   │
                         │  注册表 · 日报 · 记忆                   │
                         │  监控 · 支付 · 即时通讯                  │
                         │          JWT + RSA-4096 认证           │
                         └────┬──────────┬──────────┬───────────┘
                              │          │          │
                   ┌──────────▼──┐  ┌────▼─────┐  ┌▼───────────┐
                   │ 节点：后端  │  │节点：前端│  │节点：运维   │
                   │ 私有记忆    │  │私有记忆  │  │私有记忆     │
                   │ 任务规划器  │  │任务规划器│  │任务规划器   │
                   └─────────────┘  └──────────┘  └────────────┘

          ◄──────── 端到端加密 (RSA-4096 + AES-256-GCM) ────────►
              人类审批门控：支付 · 部署 · 删除
```

### 核心模块

| 包名 | 角色 | 核心能力 |
|------|------|---------|
| `@jackclaw/hub` | 中心协调器 | 消息路由、日报汇总、策略执行 |
| `@jackclaw/node` | Agent 工作节点 | 向 Hub 注册、执行任务、发送日报 |
| `@jackclaw/protocol` | 加密层 | RSA + AES-GCM 混合加密、消息签名 |
| `@jackclaw/memory` | 四层记忆系统 | L1 缓存 → L2 SQLite → L3 语义 → Hub 同步 |
| `@jackclaw/harness` | IDE 桥接 | 连接 Claude Code / Codex / Cursor |
| `@jackclaw/watchdog` | 人类监督 | 监控策略、只追加告警、人类确认 |
| `@jackclaw/payment-vault` | 合规支付 | 多地区规则、自动/人工阈值 |
| `@jackclaw/cli` | 管理 CLI | `jackclaw init/start/chat/status/nodes/invite` |
| `@jackclaw/dashboard` | Web 控制台 | 实时节点状态、日报、聊天 |
| `@jackclaw/tunnel` | HTTPS 隧道 | Cloudflared 安全隧道 |
| `create-jackclaw` | 脚手架 | `npm create jackclaw` 项目模板 |

### ClawChat 即时通讯

通过 WebSocket + JWT 认证连接节点、Hub 和人类。三种消息类型：

| 类型 | 发送方 | 用途 |
|------|--------|------|
| `human` | 人类操作者 | 指令、审批、覆盖 |
| `task` | Hub 或 Node | 分配任务、委派子任务 |
| `ask` | 任意 Agent | 请求信息、确认或审查 |

所有内容端到端加密——Hub 只转发密文，不解密。

### OwnerMemory 隐私模型

每个 Node 拥有私有的四层记忆：

| 层级 | 范围 | 延迟 |
|------|------|------|
| L1 热缓存 | 内存，会话级 | <5ms |
| L2 持久化 | SQLite，节点本地 | ~10ms |
| L3 语义索引 | 全组织（需 opt-in） | ~50ms |
| Hub 同步 | 双向同步，可选 | 视情况 |

L1/L2 完全私有——Hub 无法读取。L3 需要节点主动发布。记忆访问由基于角色的 ACL 控制。节点间通过**教学协议**互相传授技能。

### 自治等级

| 等级 | 标签 | 允许操作 |
|------|------|---------|
| L0 | 受监督 | 只读；所有写操作需人类审批 |
| L1 | 辅助 | 查询、列表、探测；不可修改 |
| L2 | 标准 | 读写；不含高风险操作 |
| L3 | 自主 | 完全访问，包括支付和部署 |

高风险操作（`delete`、`deploy`、`payment`、`transfer`、`broadcast`、`terminate`）无论自治等级如何，均需 L0 人类审批。

### 开发

```bash
git clone https://github.com/DevJackKong/JackClawOS.git
cd JackClawOS
npm install
npm run build
npm run dev        # Hub + Node
npm run typecheck  # 类型检查
npm test           # 运行测试
```

### 许可证

[MIT](LICENSE)

---

**Built by [Jack](https://github.com/DevJackKong) 🦞**
