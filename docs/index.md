---
layout: home

hero:
  name: JackClaw
  text: 让 AI 员工像真人一样协作
  tagline: 一个面向 Hub / Node / Agent 的多智能体协作框架，内置 CLI、SDK、REST API 与 Dashboard。
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: SDK API
      link: /api/sdk
    - theme: alt
      text: GitHub
      link: https://github.com/DevJackKong/JackClawOS

features:
  - icon: 🧠
    title: 多智能体协作
    details: Hub 负责调度、汇总与审批，Node 负责执行，Agent 像团队成员一样分工协作。
  - icon: 🔐
    title: 安全优先
    details: 端到端加密、审计日志、人类审批、高风险操作拦截，默认面向真实生产环境设计。
  - icon: ⚡
    title: 30 秒上手
    details: JackClaw 提供 demo 启动方式，可直接拉起 Hub、Node、Dashboard，快速体验完整工作流。
  - icon: 🧩
    title: 可扩展 SDK
    details: 通过 @jackclaw/sdk 定义插件、节点、命令、定时任务与生命周期钩子。
  - icon: 💬
    title: ClawChat 通信层
    details: Hub 提供 REST + WebSocket，支持离线收件箱、线程、群组、回执与协作会话。
  - icon: 📦
    title: Monorepo 包体系
    details: CLI、Hub、Node、Protocol、Memory、SDK、Harness、Tunnel、OpenClaw Plugin 等模块解耦协作。
---

## 项目概览

JackClaw 是一个 **开源多智能体协作框架**。

从 README 和 QUICKSTART 可以抽象出 4 个关键事实：

- **Hub 是总部**：负责路由任务、聚合日报、托管审批流与 Dashboard
- **Node 是员工**：负责执行任务、接入模型、维护私有记忆、对外汇报
- **CLI 是入口**：`jackclaw demo`、`jackclaw start`、`jackclaw chat`、`jackclaw ask`、`jackclaw task` 构成主要操作面
- **SDK 是扩展层**：开发者可以定义自定义插件和 Node 能力

## 快速入口

```bash
npm install
npm run build
npx jackclaw demo
```

启动后默认可访问：

- Hub: `http://localhost:3100`
- Dashboard: `http://localhost:3100`
- PWA App: `http://localhost:3100/app/`
- Health: `http://localhost:3100/health`

## 文档结构

- [快速开始](/guide/getting-started)
- [核心概念](/guide/concepts)
- [@jackclaw/sdk API](/api/sdk)
- [CLI 命令参考](/api/cli)
- [Hub REST API](/api/rest)
