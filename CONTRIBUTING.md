# Contributing to JackClaw | 贡献指南

[English](#english) | [中文](#中文)

---

<a id="english"></a>

## English

We welcome contributions! Here's how to get started.

### Setup

```bash
git clone https://github.com/DevJackKong/JackClawOS.git
cd JackClawOS
npm install
npm run build
```

### Project Structure

```
packages/
  protocol/        # Encryption & message signing
  hub/             # Central coordinator server
  node/            # Agent worker runtime
  memory/          # 4-layer memory system
  cli/             # Management CLI
  dashboard/       # Web UI
  harness/         # IDE bridge (Claude Code, Codex, Cursor)
  watchdog/        # Human oversight & alerts
  payment-vault/   # Compliance payments
  tunnel/          # HTTPS tunnel (cloudflared)
  jackclaw-sdk/    # SDK for integrations
  openclaw-plugin/ # OpenClaw plugin bridge
  create-jackclaw/ # Project scaffolding
  pwa/             # Progressive web app
```

### Guidelines

1. **TypeScript only** — no `.js` files in `src/`
2. **Run `npm run build`** before submitting — all packages must compile clean
3. **Keep packages independent** — minimize cross-package imports
4. **Write types first** — define interfaces before implementation
5. **Security-first** — all inter-node communication must be encrypted

### Pull Requests

- Fork → branch → commit → PR
- Reference related issues
- One feature/fix per PR
- Include tests for new functionality

---

<a id="中文"></a>

## 中文

欢迎贡献代码！

### 环境搭建

```bash
git clone https://github.com/DevJackKong/JackClawOS.git
cd JackClawOS
npm install
npm run build
```

### 项目结构

```
packages/
  protocol/        # 加密和消息签名
  hub/             # 中心协调服务器
  node/            # Agent 工作节点
  memory/          # 四层记忆系统
  cli/             # 管理命令行工具
  dashboard/       # Web 控制台
  harness/         # IDE 桥接（Claude Code / Codex / Cursor）
  watchdog/        # 人类监督和告警
  payment-vault/   # 合规支付
  tunnel/          # HTTPS 隧道（cloudflared）
  jackclaw-sdk/    # SDK
  openclaw-plugin/ # OpenClaw 插件桥接
  create-jackclaw/ # 项目脚手架
  pwa/             # 渐进式 Web 应用
```

### 规范

1. **仅 TypeScript** — `src/` 下不允许 `.js` 文件
2. **提交前运行 `npm run build`** — 所有包必须编译通过
3. **保持包独立** — 减少跨包导入
4. **先写类型** — 先定义接口再实现
5. **安全优先** — 节点间通信必须加密

### Pull Request 流程

- Fork → 新分支 → 提交 → PR
- 关联相关 Issue
- 每个 PR 只做一件事
- 新功能需要包含测试

---

**Code of Conduct | 行为准则：** Be respectful. Be constructive. 尊重他人，建设性沟通。
