# @jackclaw/openclaw-plugin

JackClaw 的 OpenClaw Plugin 适配层。让 CEO 通过任意 OpenClaw 渠道（飞书、微信、Telegram 等）实时查询团队汇报和节点状态。

---

## 功能

| 触发方式 | 效果 |
|---|---|
| `/jackclaw report` | 查看今日团队汇报摘要 |
| `/jackclaw status` | 查看所有节点在线情况 |
| `/jackclaw help` | 显示帮助 |
| 发送「团队汇报」「日报」「汇报摘要」 | 自动返回汇报摘要（无需命令） |
| 发送「节点状态」「在线情况」 | 自动返回节点状态 |
| 定时推送 | Hub 有新汇报时主动通知 CEO |

所有功能在任何 OpenClaw 渠道均可使用：飞书 / 微信 / Telegram / Discord / Slack 等。

---

## 安装

### 1. 在 OpenClaw 配置中添加插件路径

编辑 `~/.openclaw/config.yaml`（或 OpenClaw 配置文件）：

```yaml
plugins:
  entries:
    jackclaw:
      path: /path/to/jackclaw/packages/openclaw-plugin
```

### 2. 配置推送通知（可选）

如需 Hub 收到新汇报时主动推送，在插件配置下添加：

```yaml
plugins:
  entries:
    jackclaw:
      path: /path/to/jackclaw/packages/openclaw-plugin
      notifyTo: "your-feishu-open-id-or-telegram-id"
      notifyChannel: "feishu"   # 或 telegram / openclaw-weixin 等
```

### 3. 配置环境变量

```bash
# Hub 地址（默认 http://localhost:3100）
export JACKCLAW_HUB_URL=http://localhost:3100

# CEO JWT（用于访问 /api/nodes 和 /api/summary）
export JACKCLAW_CEO_TOKEN=your-ceo-jwt-here
```

### 4. 重启 OpenClaw Gateway

```bash
openclaw gateway restart
```

---

## 开发

```bash
# 类型检查
npm run typecheck

# 构建
npm run build

# Watch 模式
npm run dev
```

---

## 目录结构

```
packages/openclaw-plugin/
├── package.json        # name: @jackclaw/openclaw-plugin
├── tsconfig.json
├── src/
│   ├── index.ts        # Plugin 入口，注册到 OpenClaw
│   ├── plugin.ts       # Plugin 主体，注册命令/钩子/服务
│   ├── commands.ts     # 处理用户命令 + 自然语言匹配
│   └── bridge.ts       # 查询 JackClaw Hub REST API
└── README.md
```

---

## Hub API 依赖

插件通过 HTTP 调用 JackClaw Hub 的以下接口：

| 接口 | 说明 |
|---|---|
| `GET /health` | 健康检查 |
| `GET /api/nodes` | 获取所有节点列表（需 JWT） |
| `GET /api/summary` | 获取今日汇报摘要（需 JWT） |

确保 Hub 服务运行，且 `JACKCLAW_CEO_TOKEN` 有效。

---

## 工作原理

1. **命令处理**：`/jackclaw <sub>` 由 `registerCommand` 注册，OpenClaw 在消息处理前拦截。
2. **自然语言触发**：通过 `before_dispatch` hook 匹配关键词，`handled: true` 阻止 LLM 介入，直接返回查询结果。
3. **定时推送**：`registerService` 启动后台轮询（60s），新汇报到来时调用 `runtime.deliver` 推送给 CEO。
