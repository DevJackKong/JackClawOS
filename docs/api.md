# JackClaw API 文档

Base URL: `http(s)://<hub-host>:19001`

所有请求（除 `/health` 和 `/api/auth/register`）需要 `Authorization: Bearer <token>`。

---

## 认证 / Auth

### POST /api/auth/register

注册新节点，获取访问令牌。

**Request Body**
```json
{
  "nodeId": "string",       // 节点唯一 ID（可自动生成）
  "name": "string",         // 节点显示名称
  "role": "owner|member|guest",
  "publicKey": "string"     // 可选，RSA 公钥（PEM）
}
```

**Response 200**
```json
{
  "accessToken": "eyJhbGci...",
  "expiresIn": 86400,
  "tokenType": "Bearer"
}
```

**Response 409** - 节点 ID 已存在
```json
{ "error": "node_exists", "message": "Node ID already registered" }
```

---

### POST /api/auth/refresh

刷新访问令牌（令牌到期前 1h 自动触发）。

**Headers:** `Authorization: Bearer <current-token>`

**Response 200**
```json
{
  "accessToken": "eyJhbGci...",
  "expiresIn": 86400
}
```

---

## 节点管理 / Nodes

### GET /api/nodes

获取所有在线节点列表。

**Required Role:** `member` 或以上

**Response 200**
```json
{
  "nodes": [
    {
      "id": "node-abc123",
      "name": "alice-macbook",
      "role": "owner",
      "status": "online",
      "lastSeen": "2026-04-03T02:00:00Z",
      "version": "0.1.0"
    }
  ],
  "total": 1
}
```

---

### GET /api/nodes/:nodeId

获取单个节点详情。

**Response 200**
```json
{
  "id": "node-abc123",
  "name": "alice-macbook",
  "role": "owner",
  "status": "online",
  "lastSeen": "2026-04-03T02:00:00Z",
  "reportVisibility": "summary_only",
  "registeredAt": "2026-01-01T00:00:00Z"
}
```

**Response 404**
```json
{ "error": "not_found" }
```

---

### DELETE /api/nodes/:nodeId

移除节点（踢出）。

**Required Role:** `owner`

**Response 204** - No content

---

### GET /api/nodes/:nodeId/status

获取节点实时状态（WebSocket 推送版见 WS 章节）。

**Response 200**
```json
{
  "nodeId": "node-abc123",
  "online": true,
  "currentTask": null,
  "agentStatus": "idle",
  "uptime": 3600
}
```

---

## 汇报 / Reports

### POST /api/reports

节点提交汇报。**由节点 Scheduler 自动调用。**

**Request Body**
```json
{
  "nodeId": "node-abc123",
  "period": "2026-04-03",
  "visibility": "summary_only",
  "summary": {
    "tasksCompleted": 5,
    "tasksInProgress": 2,
    "highlights": ["完成了 X 功能", "修复了 Y bug"],
    "blockers": []
  },
  "fullContent": null   // visibility=full 时填写
}
```

**Response 201**
```json
{
  "reportId": "rpt-xyz789",
  "receivedAt": "2026-04-03T08:00:01Z"
}
```

---

### GET /api/reports

查询汇报列表。

**Query Parameters**

| 参数 | 类型 | 说明 |
|------|------|------|
| `nodeId` | string | 按节点过滤（owner 可查所有，member 只能查自己）|
| `from` | ISO8601 | 开始时间 |
| `to` | ISO8601 | 结束时间 |
| `limit` | number | 每页数量（默认 20，最大 100）|
| `cursor` | string | 分页游标 |

**Response 200**
```json
{
  "reports": [
    {
      "id": "rpt-xyz789",
      "nodeId": "node-abc123",
      "nodeName": "alice-macbook",
      "period": "2026-04-03",
      "summary": { "tasksCompleted": 5, "highlights": ["..."] },
      "createdAt": "2026-04-03T08:00:01Z"
    }
  ],
  "nextCursor": "cursor-abc",
  "total": 42
}
```

---

### GET /api/reports/:reportId

获取单条汇报详情。

**Response 200** - 同上单条结构（含 `fullContent` 如有权限）

---

## 任务 / Tasks

### POST /api/tasks

分发任务到目标节点。

**Required Role:** `owner`

**Request Body**
```json
{
  "targetNodeId": "node-abc123",
  "instruction": "帮我整理今日代码变更摘要",
  "priority": "normal",         // low | normal | high
  "timeout": 300,               // 秒，默认 300
  "metadata": {}                // 可选附加数据
}
```

**Response 201**
```json
{
  "taskId": "task-def456",
  "status": "queued",
  "createdAt": "2026-04-03T10:00:00Z"
}
```

---

### GET /api/tasks/:taskId

查询任务状态。

**Response 200**
```json
{
  "id": "task-def456",
  "targetNodeId": "node-abc123",
  "instruction": "帮我整理今日代码变更摘要",
  "status": "completed",        // queued | running | completed | failed | timeout
  "result": {
    "output": "今日共提交 3 次...",
    "completedAt": "2026-04-03T10:00:45Z"
  },
  "createdAt": "2026-04-03T10:00:00Z"
}
```

---

### GET /api/tasks

查询任务列表。

**Query Parameters:** `targetNodeId`, `status`, `from`, `to`, `limit`, `cursor`

---

## 健康检查 / Health

### GET /health

无需认证。

**Response 200**
```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptime": 3600,
  "nodesOnline": 2
}
```

---

## WebSocket API

连接地址：`ws(s)://<hub-host>:19001/ws`

握手时携带 token：
```
ws://localhost:19001/ws?token=<accessToken>
```

### 消息格式

所有 WS 消息为 JSON，包含 `type` 字段：

```json
{ "type": "MESSAGE_TYPE", "payload": { ... } }
```

### 客户端 → Hub

| type | payload | 说明 |
|------|---------|------|
| `heartbeat` | `{ "timestamp": number }` | 保持在线状态（每 30s）|
| `task_result` | `{ "taskId": string, "status": string, "output": string }` | 任务执行结果回调 |
| `status_update` | `{ "agentStatus": string, "currentTask": string\|null }` | 更新节点状态 |

### Hub → 客户端

| type | payload | 说明 |
|------|---------|------|
| `task_dispatch` | `{ "taskId": string, "instruction": string, "priority": string }` | 新任务下发 |
| `node_joined` | `{ "nodeId": string, "name": string }` | 新节点上线通知 |
| `node_left` | `{ "nodeId": string }` | 节点下线通知 |
| `heartbeat_ack` | `{ "timestamp": number }` | 心跳确认 |

---

## 错误码

| HTTP | error | 说明 |
|------|-------|------|
| 400 | `invalid_request` | 请求参数错误 |
| 401 | `unauthorized` | 未认证或令牌无效 |
| 403 | `forbidden` | 权限不足 |
| 404 | `not_found` | 资源不存在 |
| 409 | `conflict` | 资源冲突（如重复注册）|
| 429 | `rate_limited` | 请求频率超限 |
| 500 | `internal_error` | 服务器内部错误 |

所有错误响应格式：
```json
{
  "error": "error_code",
  "message": "Human-readable description",
  "requestId": "req-xxx"
}
```
