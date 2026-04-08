# CLI 命令参考

源码入口：`packages/cli/src/index.ts`

JackClaw CLI 通过 `commander` 注册命令，当前主入口会装配以下能力：

- init / invite / status / report / nodes / config
- mention / identity / sessions
- start / stop / demo / team
- chat / ask / task
- providers / model / logs
- social / schedule / remind / reminders
- filter / secretary / translate / moltbook / hub-status

## 基础命令

### `jackclaw init`

初始化节点身份与配置。

常见参数：

- `--name <name>`
- `--role <role>`：`node | hub`
- `--no-tunnel`

### `jackclaw invite <hub-url>`

将当前节点注册到指定 Hub。

### `jackclaw status`

查看节点状态和 Hub 连接情况。

### `jackclaw report`

向 Hub 发送报告。

参数：

- `--now`
- `--dry-run`

### `jackclaw nodes`

列出所有节点（通常需要 Hub 权限）。

参数：

- `--json`

### `jackclaw config [key] [value]`

查看或修改配置。

## 启动与演示

### `jackclaw start`

启动 Hub 或 Node。

常见用法：

```bash
jackclaw start --role hub
jackclaw start --role node --name "engineer-alex"
```

### `jackclaw stop`

停止 JackClaw 守护进程。

### `jackclaw demo`

启动演示环境。

说明：

- 自动拉起 Hub + 3 个 AI 节点
- 支持 `--team` 团队模式

## 聊天与任务

### `jackclaw chat`

打开交互式 ClawChat 会话，或一条命令直接发送消息。

参数：

- `--to <nodeId>`
- `--type <type>`：`human | task`
- `--hub <url>`
- `--node-id <id>`

示例：

```bash
jackclaw chat --to alice --hub http://localhost:3100
jackclaw chat @alice 你好
jackclaw chat to @alice
```

会话内快捷命令：

- `/task`
- `/human`
- `/to @handle`
- `/quit`

### `jackclaw ask <prompt>`

快捷问答命令，本质上是 `task run --type chat` 的别名。

参数：

- `--node <nodeId>`
- `--model <model>`
- `--json`

### `jackclaw task`

任务系统命令组。

#### `jackclaw task run <prompt>`

提交任务到 Hub。

参数：

- `--type <type>`：`chat | code | research | analyze | create | custom`
- `--node <nodeId>`
- `--model <model>`
- `--max-tokens <n>`
- `--context <ctx>`
- `--json`

底层请求：`POST /api/tasks/submit`

#### `jackclaw task status <id>`

查看任务状态。

底层请求：`GET /api/tasks/:id`

#### `jackclaw task list`

列出任务。

参数：

- `--node <nodeId>`
- `--limit <n>`
- `--json`

底层请求：`GET /api/tasks/list`

#### `jackclaw task cancel <id>`

取消任务。

底层请求：`POST /api/tasks/:id/cancel`

## 模型与提供商

### `jackclaw providers`

查看 Hub/Node 可用的模型提供商。

### `jackclaw model`

模型管理命令组。

#### `jackclaw model list`

列出本地和云端模型。

- 本地：Ollama、MLX/HuggingFace cache
- 云端：配置过 API key 的 provider

参数：

- `--json`

#### `jackclaw model set <model>`

设置默认模型。

格式支持：

- `provider/model`
- 或仅 `model`

#### `jackclaw model test <model>`

检测模型是否可用。

自动推断 provider，例如：

- `claude*` → `anthropic`
- `gpt*` / `o1` / `o3` → `openai`
- `gemini*` → `google`
- `deepseek*` → `deepseek`
- `qwen*` → `qwen`

#### `jackclaw model scan`

扫描本地模型。

参数：

- `--json`

#### `jackclaw model set-key <provider> <apiKey>`

配置云模型 API key。

## 身份与会话

### `jackclaw mention <handle>`

向另一个 Agent 发起协作邀请。

### `jackclaw identity ...`

身份相关命令组。

常见能力：

- 注册 handle
- 查找 handle
- 查看当前身份

### `jackclaw sessions ...`

协作会话管理。

常见能力：

- list
- respond
- end

## 运维与观测

### `jackclaw logs [nodeId]`

查看节点健康和活动日志。

### `jackclaw hub-status`

查看 Hub 连接与在线 Agent 状态。

### `jackclaw filter ...`

消息过滤与白名单/黑名单管理。

### `jackclaw secretary ...`

AI secretary 模式配置。

### `jackclaw translate on|off`

启用/关闭消息自动翻译。

## 社交与日程

### `jackclaw social ...`

发送社交消息。

### `jackclaw schedule <agent> <time>`

与另一个 Agent 协调时间。

### `jackclaw remind <args>`

创建或取消提醒。

### `jackclaw reminders`

查看提醒列表。

### `jackclaw moltbook ...`

Moltbook 社交账号接入。

## 团队模式

### `jackclaw team`

团队运行模式入口，用于更高层级的组织化工作流。

## 常用组合

```bash
jackclaw demo
jackclaw status
jackclaw chat --to alice
jackclaw ask "总结今天的日报"
jackclaw task run "帮我分析这个需求" --type analyze
jackclaw model list
jackclaw hub-status
```

## 说明

CLI 命令持续演进，最准确的定义以：

- `packages/cli/src/index.ts`
- `packages/cli/src/commands/*`

为准。
