# JackClaw：让 AI 员工像真人一样协作

[![Build](https://github.com/DevJackKong/JackClawOS/actions/workflows/ci.yml/badge.svg)](https://github.com/DevJackKong/JackClawOS/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![E2E](https://img.shields.io/badge/e2e-45%20passed-success)](tests/e2e.js)

> **30 seconds to your AI company** 🦞

```bash
git clone https://github.com/DevJackKong/JackClawOS.git
cd JackClawOS && npm install && npm run build
npx jackclaw start
```

→ Hub ready on `:3100` · Node ready on `:19000` · Dashboard at `:3100` · [Quick Start](QUICKSTART.md)

### ⚡ What You Get Out of the Box

| Feature | JackClaw | Single-Agent Tools |
|---------|----------|-------------------|
| Multi-agent collaboration | ✅ Built-in | ❌ |
| Agent-to-agent messaging | ✅ ClawChat (WS + REST) | ❌ |
| Daily reports & summaries | ✅ Auto-aggregated | ❌ |
| Trust & reputation system | ✅ Per-agent scoring | ❌ |
| CEO approval for high-risk ops | ✅ Human-in-loop | ❌ |
| Web dashboard | ✅ Real-time | ❌ |
| One-command demo | ✅ `jackclaw demo` | ❌ |
| End-to-end encryption | ✅ RSA-4096 + AES-256 | Varies |
| OpenClaw compatible | ✅ Plugin | N/A |

```bash
# See it in action
npx jackclaw demo
```

[English](#english) | [中文](#中文)

---

<a id="中文"></a>

## 中文

### 一句话说清楚

**JackClaw 是一个让多个 AI Agent 像公司员工一样协作的框架。**

你是 CEO，AI 是你的团队。每个 AI 有自己的记忆、技能和权限。你下指令，它们干活、汇报、互相配合。高风险操作（花钱、发布、删除）必须你亲自批准。

### 为什么需要它？

现在的 AI 工具有一个问题：**它们是孤立的。**

- ChatGPT 不知道你的 Cursor 在写什么代码
- Claude 不知道你的另一个 Claude 昨天做了什么
- 你每天花大量时间在不同 AI 之间复制粘贴上下文

想象一下，如果你的 AI 们能像真人团队一样：
- 🧑‍💻 工程师 AI 写好代码，自动通知测试 AI 去验证
- 📊 分析师 AI 发现数据异常，直接告诉运维 AI 去排查
- 💰 财务 AI 需要付款，必须等你点「批准」才能执行
- 📝 所有 AI 每天给你发工作日报

**这就是 JackClaw 做的事。**

### 怎么工作的？

```
你（CEO）
  │
  ▼
┌─────────────────────────────────┐
│           Hub（总部）            │
│                                 │
│  • 接收你的指令                   │
│  • 把任务分给对的 AI              │
│  • 汇总所有 AI 的日报             │
│  • 拦截高风险操作等你批准          │
│  • 所有通信加密，没人能偷看        │
└──────┬──────────┬──────────┬────┘
       │          │          │
   ┌───▼───┐  ┌──▼───┐  ┌──▼───┐
   │ AI-1  │  │ AI-2 │  │ AI-3 │
   │ 后端  │  │ 前端 │  │ 运维 │
   │ 工程师│  │ 设计 │  │ 部署 │
   └───────┘  └──────┘  └──────┘
   各自有私有记忆，互相教技能
```

**三个角色：**

| 角色 | 是谁 | 干什么 |
|------|------|--------|
| **你** | CEO / 老板 | 下指令，审批高风险操作 |
| **Hub** | 总部 / 调度中心 | 分活、汇报、安全管控 |
| **Node** | AI 员工 | 干活、学习、每天汇报 |

### 五个让你想用的理由

#### 1. 🧠 AI 终于有记忆了

每个 AI 有四层记忆：

| 层 | 比喻 | 作用 |
|----|------|------|
| L1 | 工作记忆 | 当前在干什么（毫秒级） |
| L2 | 笔记本 | 昨天学到了什么（本地存储） |
| L3 | 公司知识库 | 团队共享的知识（需授权） |
| L4 | 云端备份 | 同步到总部（你控制） |

**AI-1 教会了 AI-2 一个技能？AI-2 会永远记住。** 不像现在，关掉窗口就全忘了。

#### 2. 🔒 你说了算，不是 AI 说了算

JackClaw 有四个权限等级：

| 等级 | 意思 | 例子 |
|------|------|------|
| L0 受监督 | AI 只能看，不能动 | 新来的实习生 |
| L1 辅助 | 能查询，不能改 | 刚入职的员工 |
| L2 标准 | 能读能写，但不能做大事 | 正式员工 |
| L3 自主 | 几乎什么都能做 | 信任的高管 |

**但无论什么等级，花钱、删除、发布这些操作，永远需要你批准。**

#### 3. 🤝 AI 之间能真正协作

不是复制粘贴，是真正的协作：

- **任务传递**：Hub 把任务分给最合适的 AI
- **即时通讯**：AI 之间有加密聊天频道（ClawChat）
- **技能转移**：擅长写 Python 的 AI 可以教另一个 AI
- **协作会话**：两个 AI 可以共享一段记忆来合作完成任务

#### 4. 🛡️ 军事级安全

- 所有通信 RSA-4096 + AES-256 加密（和银行一个级别）
- Hub 只转发密文，自己也看不到内容
- 每个 AI 的记忆是私有的，其他 AI 和 Hub 都读不了
- 所有高风险操作有不可篡改的审计日志

#### 5. 💻 开发者友好

```bash
# 30 秒创建一个 AI 团队
npm create jackclaw@latest my-team
cd my-team

# 启动总部
jackclaw start --role hub

# 加一个 AI 员工
jackclaw start --role node --name "工程师小明"

# 给它派活
jackclaw chat --to @工程师小明 --text "帮我写个登录页面"
```

支持接入 Claude Code、Codex、Cursor 等主流 AI 工具。

### 谁适合用？

| 你是谁 | 用 JackClaw 做什么 |
|--------|-------------------|
| **独立开发者** | 一个人管理多个 AI 助手，像有了一个小团队 |
| **创业者** | 用 AI 团队代替早期招人，降低成本 |
| **技术团队** | 让 AI 处理重复工作，人类专注创造性任务 |
| **AI 爱好者** | 探索多 Agent 协作的前沿玩法 |

### 和其他工具的区别

| | ChatGPT | AutoGPT | JackClaw |
|--|---------|---------|----------|
| 多 Agent 协作 | ❌ | 有限 | ✅ 完整 |
| 持久记忆 | 有限 | ❌ | ✅ 四层 |
| 人类审批 | ❌ | ❌ | ✅ 内置 |
| 加密通信 | ❌ | ❌ | ✅ 军事级 |
| IDE 集成 | ❌ | ❌ | ✅ Claude/Codex/Cursor |
| 开源免费 | ❌ | ✅ | ✅ MIT |

### 现在就开始

```bash
npm install -g jackclaw
jackclaw init my-first-team
```

📦 GitHub：[github.com/DevJackKong/JackClawOS](https://github.com/DevJackKong/JackClawOS)
📄 协议：MIT（免费，随便用）

---

<a id="english"></a>

## English

### One Line

**JackClaw is a framework that lets multiple AI agents collaborate like a real company.**

You're the CEO. AI agents are your team. Each has its own memory, skills, and permissions. You give orders, they work, report back, and help each other. High-risk actions (spending money, deploying, deleting) require your explicit approval.

### Why?

Today's AI tools have a problem: **they're isolated.**

- ChatGPT doesn't know what your Cursor is coding
- Claude doesn't know what your other Claude did yesterday
- You spend hours copy-pasting context between AI tools

Imagine if your AI agents could work like a real team:
- 🧑‍💻 Engineer AI finishes code → automatically notifies Tester AI to verify
- 📊 Analyst AI spots a data anomaly → tells DevOps AI to investigate
- 💰 Finance AI needs to make a payment → waits for your "Approve" before executing
- 📝 Every AI sends you a daily work report

**That's what JackClaw does.**

### How It Works

```
You (CEO)
  │
  ▼
┌─────────────────────────────────┐
│           Hub (HQ)              │
│                                 │
│  • Receives your commands       │
│  • Routes tasks to the right AI │
│  • Aggregates daily reports     │
│  • Blocks high-risk actions     │
│  • All comms encrypted          │
└──────┬──────────┬──────────┬────┘
       │          │          │
   ┌───▼───┐  ┌──▼───┐  ┌──▼───┐
   │ AI-1  │  │ AI-2 │  │ AI-3 │
   │Backend│  │Front │  │DevOps│
   │  Dev  │  │ End  │  │  Ops │
   └───────┘  └──────┘  └──────┘
   Each has private memory, can teach each other skills
```

**Three roles:**

| Role | Who | What They Do |
|------|-----|-------------|
| **You** | CEO / Owner | Give orders, approve high-risk actions |
| **Hub** | HQ / Dispatcher | Route tasks, collect reports, enforce security |
| **Node** | AI Employee | Do the work, learn, report daily |

### Five Reasons You'll Want This

#### 1. 🧠 AI Finally Has Memory

Each AI has four memory layers:

| Layer | Analogy | Purpose |
|-------|---------|---------|
| L1 | Working memory | What I'm doing right now (<5ms) |
| L2 | Notebook | What I learned yesterday (local) |
| L3 | Company wiki | Shared team knowledge (opt-in) |
| L4 | Cloud backup | Synced to HQ (you control) |

**AI-1 teaches AI-2 a skill? AI-2 remembers forever.** Unlike now, where closing the tab means starting over.

#### 2. 🔒 You're in Control, Not the AI

Four permission levels:

| Level | Meaning | Like... |
|-------|---------|---------|
| L0 Supervised | Read-only | New intern |
| L1 Assisted | Can query, can't change | Junior hire |
| L2 Standard | Read + write, no big moves | Regular employee |
| L3 Autonomous | Almost everything | Trusted executive |

**But regardless of level, spending money, deleting things, and deploying always need your approval.**

#### 3. 🤝 Real Collaboration Between AIs

Not copy-paste. Real collaboration:

- **Task routing**: Hub assigns tasks to the best-fit AI
- **Instant messaging**: Encrypted chat between AIs (ClawChat)
- **Skill transfer**: A Python expert AI can teach another AI
- **Collab sessions**: Two AIs share memory to work on a task together

#### 4. 🛡️ Military-Grade Security

- All communication encrypted with RSA-4096 + AES-256 (bank-level)
- Hub only relays ciphertext — it can't read the content
- Each AI's memory is private — other AIs and the Hub can't access it
- Tamper-proof audit logs for all high-risk actions

#### 5. 💻 Developer-Friendly

```bash
# Create an AI team in 30 seconds
npm create jackclaw@latest my-team
cd my-team

# Start HQ
jackclaw start --role hub

# Add an AI employee
jackclaw start --role node --name "engineer-alex"

# Assign work
jackclaw chat --to @engineer-alex --text "Build me a login page"
```

Works with Claude Code, Codex, Cursor, and more.

### Who Is This For?

| You Are... | Use JackClaw To... |
|------------|-------------------|
| **Solo developer** | Manage multiple AI assistants like having a small team |
| **Startup founder** | Replace early hires with an AI team, cut costs |
| **Tech team** | Let AI handle repetitive work, humans focus on creative tasks |
| **AI enthusiast** | Explore cutting-edge multi-agent collaboration |

### How It Compares

| | ChatGPT | AutoGPT | JackClaw |
|--|---------|---------|----------|
| Multi-agent collab | ❌ | Limited | ✅ Full |
| Persistent memory | Limited | ❌ | ✅ 4-layer |
| Human approval | ❌ | ❌ | ✅ Built-in |
| Encrypted comms | ❌ | ❌ | ✅ Military-grade |
| IDE integration | ❌ | ❌ | ✅ Claude/Codex/Cursor |
| Open source & free | ❌ | ✅ | ✅ MIT |

### Get Started

```bash
npm install -g jackclaw
jackclaw init my-first-team
```

📦 GitHub: [github.com/DevJackKong/JackClawOS](https://github.com/DevJackKong/JackClawOS)
📄 License: MIT (free, use however you want)

---

**Built by [Jack](https://github.com/DevJackKong) 🦞**

*One person. Fifty AI agents. That's JackClaw.*
