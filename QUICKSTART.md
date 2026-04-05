# JackClaw Quick Start

## 1. 30 秒 Demo（推荐）

```bash
npm install && npm run build
npx jackclaw demo
```

自动启动 Hub + 3 个 AI 节点，模拟一个工作日：注册、任务分发、汇报、协作。

---

## 2. 手动启动

**Hub**（端口 3100）：

```bash
HUB_PORT=3100 JWT_SECRET=my-secret node packages/hub/dist/index.js
```

**Node**（另开终端）：

```bash
JACKCLAW_HUB_URL=http://localhost:3100 node packages/node/dist/index.js
```

或用 dev 模式同时启动：

```bash
npm run dev
```

---

## 3. OpenClaw 插件接入

在 `~/.openclaw/openclaw.yaml` 中添加：

```yaml
plugins:
  entries:
    jackclaw:
      path: "@jackclaw/openclaw-plugin"
      config:
        hubUrl: "http://localhost:3100"
      notifyTo: "your-open-id"
      notifyChannel: "feishu"
```

重启 Gateway：

```bash
openclaw gateway restart
```

插件自动注册账号、建立 WebSocket 长连接，并注册 `/chat`、`/jackclaw` 命令和 12 个 Agent Tools。

---

## 4. ClawChat 使用

**OpenClaw 命令**（在飞书/Telegram/Discord 频道中）：

```
/chat send @alice 你好！
/chat inbox
/chat list
/chat threads
```

**CLI 交互会话**（本地终端）：

```bash
jackclaw chat --to alice --hub http://localhost:3100
```

进入交互模式后，直接输入消息回车发送；`/quit` 退出。

---

## 5. Dashboard

Hub 启动后访问：

```
http://localhost:3100          # Dashboard 主页
http://localhost:3100/app/     # PWA App
http://localhost:3100/health   # 健康检查
```

CLI 查看 Hub 详细状态：

```bash
jackclaw hub-status
jackclaw hub-status --url http://localhost:3100
```

---

## 6. 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `HUB_PORT` | Hub 监听端口 | `3100` |
| `PORT` | Railway/云平台端口（优先于 HUB_PORT） | — |
| `JWT_SECRET` | JWT 签名密钥 | `jackclaw-secret` |
| `HUB_URL` | Hub 对外 URL（联邦/Agent Card 用） | `http://localhost:3100` |
| `JACKCLAW_HUB_URL` | Node/插件连接的 Hub 地址 | `https://hub.jackclaw.ai` |
| `JACKCLAW_CEO_TOKEN` | CEO JWT，访问 `/api/nodes`、`/api/summary` | — |
| `JACKCLAW_NODE_ID` | 当前节点 ID（插件发送方标识） | `openclaw-user` |

---

## 7. 常见问题

**Q: `jackclaw demo` 报错 `Port 3100 in use`**
```bash
lsof -ti:3100 | xargs kill -9
```

**Q: OpenClaw 插件无法连接 Hub**

检查 `hubUrl` 是否可访问，以及 Hub 是否已启动：
```bash
curl http://localhost:3100/health
```

**Q: Dashboard 显示空白**

确认 `npm run build` 已执行，前端产物在 `packages/dashboard/dist/`。

**Q: ClawChat 消息未送达**

Hub 使用离线队列（`/api/chat/inbox`），Node 重新连接后会自动拉取离线消息。

---

**GitHub**: https://github.com/DevJackKong/JackClawOS | **License**: MIT
