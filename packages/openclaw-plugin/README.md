# @jackclaw/openclaw-plugin

一行配置，让任意 OpenClaw 渠道（飞书、微信、Telegram 等）接入 JackClaw——查询团队汇报、节点状态、发起 Agent 协作、收发消息，全部到位。

---

## 安装

```bash
npm install @jackclaw/openclaw-plugin
```

**Node.js 要求**：>= 22。`openclaw` >= 2026.3.28 为 peer dependency，须已安装。

---

## 快速配置

在 `~/.openclaw/openclaw.yaml` 中添加一段：

```yaml
plugins:
  entries:
    jackclaw:
      path: "@jackclaw/openclaw-plugin"
      config:
        hubUrl: "https://hub.jackclaw.ai"   # 或 http://localhost:3100
```

重启 Gateway：

```bash
openclaw gateway restart
```

完成。插件自动注册命令、工具和后台推送服务。

---

## 完整配置示例

```yaml
plugins:
  entries:
    jackclaw:
      path: "@jackclaw/openclaw-plugin"
      config:
        hubUrl: "https://hub.jackclaw.ai"
        autoRegister: true            # 默认 true，启动时自动注册 ClawChat 账号
      notifyTo: "your-feishu-open-id" # 推送通知目标 ID
      notifyChannel: "feishu"         # 推送渠道：feishu / telegram / discord 等
```

---

## 功能

### `/chat` 命令

ClawChat 消息收发，支持私聊和群组。

| 子命令 | 示例 | 说明 |
|---|---|---|
| `send` | `/chat send @alice 你好！` | 发送私信给指定用户 |
| `inbox` | `/chat inbox` | 查看未读消息列表 |
| `list` | `/chat list` | 查看当前在线用户 |
| `search` | `/chat search alice` | 按关键词搜索用户（handle / 显示名） |
| `threads` | `/chat threads` | 查看所有聊天会话 |
| `reply` | `/chat reply thread-123 收到！` | 回复指定会话 |
| `group create` | `/chat group create 项目组 @alice @bob` | 创建群组并加入成员 |
| `group list` | `/chat group list` | 查看我加入的所有群组 |
| `group send` | `/chat group send grp-123 大家好！` | 向群组发送消息 |
| `help` | `/chat help` | 显示完整帮助 |

---

### `/jackclaw` 命令

JackClaw Hub 状态查询与账号管理。

| 子命令 | 示例 | 说明 |
|---|---|---|
| `status` | `/jackclaw status` | 查看所有节点在线情况 |
| `report` | `/jackclaw report` | 查看今日团队汇报摘要 |
| `profile` | `/jackclaw profile` | 查看 ClawChat 账号信息 |
| `profile --name` | `/jackclaw profile --name "新昵称"` | 修改显示名 |
| `help` | `/jackclaw help` | 显示帮助 |

**自然语言触发**（无需命令前缀）：

| 触发词 | 效果 |
|---|---|
| 「团队汇报」「日报」「今日汇报」「汇报摘要」 | 返回今日汇报摘要 |
| 「节点状态」「在线情况」「节点在线」 | 返回节点在线情况 |

---

### Agent Tools

插件将 JackClaw 能力注册为 OpenClaw LLM Agent 可直接 `call_tool` 调用的工具。

#### 5 个协作工具

| 工具名 | 说明 | 必填参数 |
|---|---|---|
| `jackclaw_mention` | @某个 Agent，发起协作邀请，附带主题和初始消息 | `targetNodeId`, `topic` |
| `jackclaw_send_task` | 向指定节点发送任务，支持优先级和截止时间 | `targetNodeId`, `title` |
| `jackclaw_check_trust` | 查询本节点对目标节点的信任评分（0-100）及协作历史 | `targetNodeId` |
| `jackclaw_my_sessions` | 列出本节点当前所有活跃协作会话（pending/active） | 无 |
| `jackclaw_plan_task` | 为开发任务生成结构化执行计划：耗时、Token 成本、并行策略 | `title`, `description` |

#### 7 个聊天工具

| 工具名 | 说明 | 必填参数 |
|---|---|---|
| `jackclaw_chat_send` | 发送消息给用户或 Agent（支持 `human` / `task` 消息类型） | `to`, `message` |
| `jackclaw_chat_inbox` | 查看收件箱，按时间倒序返回最新消息 | 无 |
| `jackclaw_chat_threads` | 查看所有聊天会话及最后一条消息预览 | 无 |
| `jackclaw_chat_search_users` | 按关键词模糊搜索用户（handle / 显示名） | `query` |
| `jackclaw_chat_online` | 查看当前实时在线的用户列表 | 无 |
| `jackclaw_chat_group_create` | 创建 ClawChat 群组并添加成员 | `name`, `members` |
| `jackclaw_chat_group_list` | 列出当前节点所属的所有群组 | 无 |

---

### 自动注册

启动时（`autoRegister: true`，默认开启）插件自动：

1. 向 Hub 注册 ClawChat 账号（幂等，重复启动不创建重复账号）
2. 建立 WebSocket 长连接，实时接收消息
3. 首次注册时通过配置的推送渠道发送欢迎消息

设为 `false` 可跳过注册（离线模式）：

```yaml
config:
  autoRegister: false
```

---

### 消息推送

Hub 轮询服务每 60 秒检查一次，新汇报到来时通过配置的渠道主动推送通知给 CEO：

```
🔔 JackClaw 新汇报
有 3 个节点提交了新汇报。
...
```

ClawChat 收到的新消息也会实时转发到推送渠道（格式：`💬 ClawChat | @alice: 消息内容`）。

推送需在 `openclaw.yaml` 配置 `notifyTo` 和 `notifyChannel`。

---

## 环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `JACKCLAW_HUB_URL` | Hub 地址（`config.hubUrl` 未配置时生效） | `https://hub.jackclaw.ai` |
| `JACKCLAW_CEO_TOKEN` | CEO JWT，用于访问 `/api/nodes` 和 `/api/summary` | — |
| `JACKCLAW_NODE_ID` | 当前节点 ID，用于 `/chat send` 的发件人标识 | `openclaw-user` |

```bash
export JACKCLAW_HUB_URL=http://localhost:3100
export JACKCLAW_CEO_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
export JACKCLAW_NODE_ID=agent-ceo-01
```

---

## 高级配置

### `hubUrl`

**优先级**：`config.hubUrl`（yaml）> `JACKCLAW_HUB_URL`（环境变量）> `https://hub.jackclaw.ai`（内置默认）

```yaml
config:
  hubUrl: "http://internal-hub:3100"  # 内网部署场景
```

### `autoRegister`

控制启动时是否自动注册并连接 ClawChat。

```yaml
config:
  autoRegister: false  # 纯汇报/状态查询场景，不需要 Chat 功能时可关闭
```

### 推送配置

```yaml
notifyTo: "ou_xxxxxxxxxxxx"   # 飞书 open_id / Telegram chat_id / Discord user_id
notifyChannel: "feishu"       # 匹配 OpenClaw 渠道名
```

---

## Hub API 依赖

| 接口 | 说明 |
|---|---|
| `GET /health` | 健康检查（无鉴权） |
| `GET /api/nodes` | 节点列表（需 JWT） |
| `GET /api/summary` | 今日汇报摘要（需 JWT） |
| `POST /api/chat/send` | 发送消息 |
| `GET /api/chat/inbox` | 收件箱 |
| `GET /api/chat/threads` | 会话列表 |
| `GET /api/search/contacts` | 搜索用户 |
| `GET /api/presence/online` | 在线状态 |
| `POST /api/chat/group/create` | 创建群组 |
| `GET /api/chat/groups` | 群组列表 |
| `POST /api/plan/estimate` | 任务规划 |
| `GET /api/trust/:from/:to` | 信任度查询 |

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
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts          # Plugin 入口，注册到 OpenClaw
│   ├── plugin.ts         # Plugin 主体：命令、钩子、推送服务
│   ├── commands.ts       # /chat 和 /jackclaw 命令处理器
│   ├── agent-tool.ts     # 12 个 Agent Tools 定义
│   ├── bridge.ts         # Hub REST API 封装
│   ├── chat-bridge.ts    # ClawChat WebSocket 客户端
│   ├── clawchat-auth.ts  # ClawChat 注册/认证
│   └── hooks/
│       ├── heartbeat.hook.ts
│       └── compact.hook.ts
└── dist/                 # 构建产物（tsc）
```
