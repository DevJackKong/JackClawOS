# CLI 命令参考

`jackclaw` 是 JackClaw 的命令行工具，提供节点管理、聊天、AI 对话等核心功能。

**安装**

```bash
npm install -g jackclaw
```

**全局选项**

| 选项 | 说明 |
|------|------|
| `--help`, `-h` | 显示帮助信息 |
| `--version`, `-v` | 显示版本号 |
| `--hub <url>` | 指定 Hub 地址（默认 `http://localhost:19001`）|
| `--token <jwt>` | 手动指定 JWT（优先于 `~/.jackclaw/auth.json`）|

---

## jackclaw init

初始化 JackClaw 项目，在当前目录生成配置文件 `jackclaw.config.js`。

```bash
jackclaw init [选项]
```

**选项**

| 选项 | 默认 | 说明 |
|------|------|------|
| `--name <name>` | 当前目录名 | 项目名称 |
| `--port <port>` | `19001` | Hub 监听端口 |
| `--nodes <n>` | `2` | 初始 Node 数量 |
| `--yes`, `-y` | — | 跳过交互式问答，使用默认值 |

**示例**

```bash
# 交互式初始化
jackclaw init

# 静默初始化（CI 环境）
jackclaw init --name my-ai-team --port 3000 --nodes 3 --yes
```

生成的 `jackclaw.config.js`：

```js
module.exports = {
  hub: {
    port: 19001,
    secret: process.env.JACKCLAW_SECRET,
  },
  nodes: {
    count: 2,
    maxConcurrent: 5,
    timeout: 30000,
  },
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: process.env.ANTHROPIC_BASE_URL,
  },
  plugins: ['@jackclaw/memory', '@jackclaw/watchdog'],
}
```

---

## jackclaw start

启动 Hub 和所有 Node。

```bash
jackclaw start [选项]
```

**选项**

| 选项 | 默认 | 说明 |
|------|------|------|
| `--config <path>` | `./jackclaw.config.js` | 配置文件路径 |
| `--hub-only` | — | 仅启动 Hub，不启动 Node |
| `--no-dashboard` | — | 不启动 Web Dashboard |
| `--detach`, `-d` | — | 后台运行（守护进程模式）|

**示例**

```bash
# 前台启动
jackclaw start

# 后台启动
jackclaw start --detach

# 仅启动 Hub
jackclaw start --hub-only
```

---

## jackclaw stop

停止正在运行的 Hub 和 Node 进程（仅限通过 `--detach` 启动的进程）。

```bash
jackclaw stop [选项]
```

**选项**

| 选项 | 说明 |
|------|------|
| `--force`, `-f` | 强制终止（SIGKILL），不等待优雅退出 |

**示例**

```bash
jackclaw stop
jackclaw stop --force
```

---

## jackclaw demo

一键启动演示环境：自动初始化、启动 Hub + 两个 Node，并打开 Dashboard。无需任何配置。

```bash
jackclaw demo [选项]
```

**选项**

| 选项 | 默认 | 说明 |
|------|------|------|
| `--hub-port <port>` | `3000` | Hub 监听端口 |
| `--nodes <n>` | `2` | 自动启动的 Node 数量 |
| `--no-open` | — | 不自动打开浏览器 |

**示例**

```bash
# 最简启动（无需安装）
npx jackclaw demo

# 自定义端口，不打开浏览器
jackclaw demo --hub-port 8080 --no-open
```

Demo 启动后可访问：

| 服务 | 地址 |
|------|------|
| Dashboard | http://localhost:3000 |
| Hub API | http://localhost:3000/api |
| WebSocket | ws://localhost:3000/ws |

---

## jackclaw chat

聊天相关子命令，通过 Hub 中继与其他用户或 Node 通信。

### jackclaw chat send

发送一条消息给指定用户。

```bash
jackclaw chat send <to> <message> [选项]
```

**参数**

| 参数 | 说明 |
|------|------|
| `<to>` | 接收方用户名 |
| `<message>` | 消息内容（明文，自动加密后发送）|

**选项**

| 选项 | 说明 |
|------|------|
| `--thread <id>` | 指定会话 ID，不传则创建新会话 |
| `--file <path>` | 发送文件（附加在消息中）|

**示例**

```bash
# 发送文字消息
jackclaw chat send bob "Hi Bob, task complete!"

# 在指定会话中回复
jackclaw chat send bob "Check the report" --thread thrd_01HXK9
```

---

### jackclaw chat inbox

查看未读消息。

```bash
jackclaw chat inbox [选项]
```

**选项**

| 选项 | 默认 | 说明 |
|------|------|------|
| `--limit <n>` | 20 | 最多显示条数 |
| `--since <timestamp>` | — | 只显示该时间戳之后的消息 |
| `--json` | — | 以 JSON 格式输出，便于脚本处理 |

**示例**

```bash
jackclaw chat inbox
jackclaw chat inbox --limit 5 --json
```

**输出示例**

```
[2 unread messages]

From: alice  |  2026-04-05 14:32
> Hi, the report is ready.

From: node-worker  |  2026-04-05 14:35
> Task t42 completed successfully.
```

---

### jackclaw chat list

列出所有会话（Thread）。

```bash
jackclaw chat list [选项]
```

**选项**

| 选项 | 默认 | 说明 |
|------|------|------|
| `--page <n>` | 1 | 页码 |
| `--size <n>` | 20 | 每页条数 |
| `--json` | — | JSON 格式输出 |

**示例**

```bash
jackclaw chat list
jackclaw chat list --size 5 --json
```

---

### jackclaw chat search

在消息历史中全文搜索。

```bash
jackclaw chat search <keyword> [选项]
```

**选项**

| 选项 | 说明 |
|------|------|
| `--from <user>` | 只搜索指定发送方的消息 |
| `--thread <id>` | 只在指定会话中搜索 |
| `--limit <n>` | 最多返回条数（默认 20）|

**示例**

```bash
jackclaw chat search "deploy"
jackclaw chat search "error" --from node-worker --limit 5
```

---

### jackclaw chat group

创建群组会话。

```bash
jackclaw chat group <name> <member1> <member2> [更多成员...]
```

**示例**

```bash
jackclaw chat group "AI Team" alice bob node-ceo node-worker
```

---

## jackclaw social

社交通知相关子命令。

### jackclaw social send

发送社交通知消息（不加密，适合广播/通知场景）。

```bash
jackclaw social send <to> <message> [选项]
```

**选项**

| 选项 | 默认 | 说明 |
|------|------|------|
| `--type <type>` | `message` | 消息类型：`message` \| `notification` \| `invite` |

**示例**

```bash
jackclaw social send alice "Sprint review at 3pm!"
jackclaw social send team-lead "Node worker-02 is ready" --type notification
```

---

### jackclaw social contacts

列出可联系的用户（当前在线用户）。

```bash
jackclaw social contacts [选项]
```

**选项**

| 选项 | 说明 |
|------|------|
| `--filter <prefix>` | 按用户名前缀过滤 |
| `--all` | 包含离线用户（需 Hub 支持）|

**示例**

```bash
jackclaw social contacts
jackclaw social contacts --filter node-
```

---

## jackclaw ask

直接向 LLM 发送一条提问，不经过 Node 系统，适合快速单次查询。

```bash
jackclaw ask <question> [选项]
```

**选项**

| 选项 | 默认 | 说明 |
|------|------|------|
| `--model <id>` | 配置文件中的 model | 指定模型 ID |
| `--system <prompt>` | — | 自定义 system prompt |
| `--stream` | — | 流式输出 |
| `--json` | — | 要求 LLM 以 JSON 格式回答 |

**示例**

```bash
# 简单问答
jackclaw ask "用一句话解释量子纠缠"

# 指定模型，流式输出
jackclaw ask "写一个快速排序的 Python 实现" \
  --model claude-opus-4-6 \
  --stream

# JSON 格式回答
jackclaw ask "列出 5 个编程语言及其适用场景" --json
```

---

## jackclaw model

管理 LLM 模型配置。

### jackclaw model list

列出所有已配置的模型和提供商。

```bash
jackclaw model list
```

**输出示例**

```
Provider: anthropic
  ✓ claude-sonnet-4-6  (active)
  ✓ claude-opus-4-6
  ✓ claude-haiku-4-5

Provider: openai
  ✓ gpt-4o
```

---

### jackclaw model set

切换默认模型。

```bash
jackclaw model set <model-id>
```

**示例**

```bash
jackclaw model set claude-opus-4-6
```

---

## jackclaw providers

管理 LLM 提供商（API 密钥、Base URL）。

### jackclaw providers list

列出所有配置的提供商。

```bash
jackclaw providers list
```

### jackclaw providers add

添加一个新提供商。

```bash
jackclaw providers add <name> [选项]
```

**选项**

| 选项 | 说明 |
|------|------|
| `--api-key <key>` | API 密钥 |
| `--base-url <url>` | API 地址（用于代理或私有部署）|
| `--type <type>` | 提供商类型：`anthropic` \| `openai` \| `custom` |

**示例**

```bash
# 添加 Anthropic（通过聚合代理）
jackclaw providers add road2all \
  --type anthropic \
  --api-key $ANTHROPIC_API_KEY \
  --base-url https://api.road2all.com

# 添加 OpenAI
jackclaw providers add openai \
  --type openai \
  --api-key $OPENAI_API_KEY
```

### jackclaw providers remove

移除一个提供商配置。

```bash
jackclaw providers remove <name>
```

**示例**

```bash
jackclaw providers remove road2all
```
