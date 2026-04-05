# ClawChat 使用指南

ClawChat 是 JackClaw 内置的实时协作通信层，基于 WebSocket 实现 Hub ↔ Node ↔ Dashboard 三向消息传递，并支持群组管理与断线重连。

---

## WebSocket 连接流程

### 连接建立

```
客户端                            Hub WS Server
  │                                    │
  │  WS ws://hub:3000/ws               │
  │  ?token=<JWT>&client=node          │
  │───────────────────────────────────>│
  │                                    │ 验证 JWT
  │  { "type": "connected",            │
  │    "node_id": "node-abc123",       │
  │    "server_time": 1712345678000 }  │
  │<───────────────────────────────────│
  │                                    │
  │  { "type": "node.heartbeat" }      │ ← 每 10s
  │───────────────────────────────────>│
```

### 连接参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `token` | 是 | JWT，与 Hub 共享 `JWT_SECRET` |
| `client` | 是 | `node` / `dashboard` / `sdk` |
| `group` | 否 | 订阅指定群组的消息 |
| `version` | 否 | 协议版本（默认 `v1`）|

### 连接示例（Node.js）

```typescript
import WebSocket from 'ws'
import { signToken } from '@jackclaw/protocol'

const token = signToken({ nodeId: 'my-node', role: 'worker' }, process.env.JWT_SECRET!)
const ws = new WebSocket(`ws://localhost:3000/ws?token=${token}&client=node`)

ws.on('open', () => {
  console.log('Connected to Hub')
})

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString())
  handleMessage(msg)
})
```

---

## 消息格式

### 基础 Envelope

所有消息均使用统一的 JSON Envelope：

```typescript
interface ClawMessage {
  // 消息类型（见下方事件列表）
  type: string

  // 消息唯一 ID（Hub 生成，用于去重 & 确认）
  msg_id: string

  // 发送方 ID（node_id / dashboard / sdk）
  from: string

  // 目标（node_id / group_id / "broadcast" / "hub"）
  to?: string

  // 消息时间戳（Unix ms）
  ts: number

  // 业务 payload（因 type 不同而异）
  payload: Record<string, unknown>
}
```

### TaskBundle 格式

任务广播的核心 payload：

```typescript
interface TaskBundle {
  task_id: string           // Hub 分配的唯一任务 ID
  title: string             // 任务标题（人类可读）
  description: string       // 详细描述
  priority: 'low' | 'normal' | 'high' | 'critical'
  tags: string[]            // 能力标签（Node 按此过滤）
  deadline?: number         // 截止时间（Unix ms），可选
  context?: {
    files?: string[]        // 相关文件路径
    memory_keys?: string[]  // 记忆系统 key
    parent_task?: string    // 父任务 ID（子任务链）
  }
  constraints?: {
    require_hitl?: boolean  // 是否必须 Human-in-Loop
    max_tokens?: number     // LLM 最大 token 数
    allowed_tools?: string[]// 允许调用的工具列表
  }
}
```

### 完整事件列表

```typescript
// 任务相关
'task.broadcast'   // Hub → Node   新任务广播
'task.claimed'     // Node → Hub   认领确认
'task.progress'    // Node → Hub   执行进度
'task.complete'    // Node → Hub   任务完成
'task.failed'      // Node → Hub   任务失败
'task.cancelled'   // Hub → Node   任务取消

// Node 管理
'node.registered'  // Hub → Node   注册成功
'node.heartbeat'   // Node → Hub   心跳
'node.disconnect'  // Hub 内部     Node 掉线检测

// 群组
'group.join'       // 客户端 → Hub  加入群组
'group.leave'      // 客户端 → Hub  退出群组
'group.message'    // 群内广播      群组消息
'group.members'    // Hub → 客户端  成员列表更新

// Human-in-Loop
'hitl.request'     // Hub → CEO    等待确认
'hitl.response'    // CEO → Hub    用户决定

// Dashboard
'dashboard.update' // Hub → Dashboard  状态快照推送
'dashboard.log'    // Hub → Dashboard  实时日志流

// 系统
'connected'        // Hub → 客户端  连接建立成功
'error'            // Hub → 客户端  错误通知
'ping' / 'pong'    // 双向         保活探测
```

---

## 群组管理

群组允许将消息广播限定在特定 Node 子集，适用于多项目隔离、按能力分组等场景。

### 创建 / 加入群组

```typescript
// 加入群组
ws.send(JSON.stringify({
  type: 'group.join',
  msg_id: crypto.randomUUID(),
  from: nodeId,
  to: 'hub',
  ts: Date.now(),
  payload: {
    group_id: 'frontend-team',
    metadata: { capabilities: ['react', 'css', 'figma'] }
  }
}))
```

Hub 回应：

```json
{
  "type": "group.members",
  "msg_id": "hub-gen-001",
  "from": "hub",
  "to": "frontend-team",
  "ts": 1712345680000,
  "payload": {
    "group_id": "frontend-team",
    "members": ["node-abc", "node-def"],
    "count": 2
  }
}
```

### 向群组广播任务

```bash
# REST API：向指定群组提交任务
curl -X POST http://localhost:3000/api/task/submit \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "task": { "title": "审查前端 PR", "description": "..." },
    "target": { "group": "frontend-team" }
  }'
```

### 退出群组

```typescript
ws.send(JSON.stringify({
  type: 'group.leave',
  msg_id: crypto.randomUUID(),
  from: nodeId,
  to: 'hub',
  ts: Date.now(),
  payload: { group_id: 'frontend-team' }
}))
```

---

## 断线重连

### 内置重连策略

`@jackclaw/node` SDK 内置指数退避重连：

```typescript
import { createNode } from '@jackclaw/node'

const node = createNode({
  hubUrl: 'ws://localhost:3000/ws',
  token: myJwt,
  reconnect: {
    enabled: true,
    maxAttempts: 10,        // 最大重试次数（0 = 无限）
    initialDelay: 1_000,    // 首次重试延迟（ms）
    maxDelay: 30_000,       // 最大延迟上限（ms）
    factor: 2,              // 指数退避系数
    jitter: true,           // 加入随机抖动，避免惊群
  }
})

node.on('reconnecting', ({ attempt, delay }) => {
  console.log(`重连中（第 ${attempt} 次），${delay}ms 后重试`)
})

node.on('reconnected', () => {
  console.log('重连成功，Hub 状态已同步')
})
```

### 重连后的状态恢复

重连成功后，Hub 自动下发该 Node 的未完成任务：

```
Node 重连成功
    │
    ▼
Hub 查询 node_id 关联的 claimed 状态任务
    │
    ▼
重新广播：task.broadcast（带 is_resume: true 标记）
    │
    ▼
Node 从断点续行（或重新执行，取决于 idempotency key）
```

### 手动实现重连（低级 API）

```typescript
function connectWithRetry(url: string, token: string) {
  let attempts = 0

  function connect() {
    const ws = new WebSocket(`${url}?token=${token}&client=node`)

    ws.on('close', (code) => {
      if (code === 1008) return  // 认证失败，不重试
      const delay = Math.min(1000 * 2 ** attempts, 30_000)
      attempts++
      setTimeout(connect, delay + Math.random() * 1000)
    })

    ws.on('open', () => { attempts = 0 })

    return ws
  }

  return connect()
}
```

---

## OpenClaw 集成

ClawChat 通过 `openclaw-plugin` 与 Claude Code 深度集成，无需额外配置即可在 Claude Code 会话中接收任务。

### 架构示意

```
Claude Code Session
  │
  ├─ openclaw-plugin（内嵌 Hub 客户端）
  │    │
  │    ├─ WS 连接到 Hub
  │    ├─ 订阅 task.broadcast
  │    └─ 将任务注入 Claude 上下文
  │
  └─ Claude（作为 Node 执行任务）
       │
       └─ 通过 plugin API 上报结果
```

### 插件消息钩子

```typescript
// openclaw 插件配置（~/.claude/settings.json）
{
  "openclaw": {
    "hub": { "url": "ws://localhost:3000/ws" },
    "hooks": {
      // 任务到达时的提示词前缀
      "task_prefix": "你收到了一个来自 JackClaw Hub 的任务：\n",
      // 完成后自动上报
      "auto_report": true,
      // 仅接受带指定标签的任务
      "filter_tags": ["claude-code", "coding"]
    }
  }
}
```

### 手动触发任务（在 Claude Code 中）

```bash
# 在 Claude Code 终端中
claude hub task submit --title "生成单元测试" --tag claude-code
```

---

## 下一步

- [安全指南](/guide/security) — JWT 配置与 Human-in-Loop 深度解析
- [API 协议参考](/api/protocol) — TaskBundle 完整 Schema
- [架构总览](/guide/architecture) — Hub/Node/CEO 三角模型
