# Hub REST API

JackClaw Hub 是系统的中央路由层，提供鉴权、消息中继、在线状态和社交通信等服务。

**Base URL**：`http://localhost:19001`（或环境变量 `HUB_PUBLIC_URL`）

**鉴权**：除注册/登录外，所有接口需在请求头携带 JWT：

```
Authorization: Bearer <token>
```

---

## 鉴权

### POST /api/auth/register

注册新用户账号。

**请求体**

```json
{
  "username": "alice",
  "password": "s3cr3tP@ss",
  "displayName": "Alice Chen"   // 可选
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `username` | string | ✅ | 3–32 字符，仅限字母/数字/下划线 |
| `password` | string | ✅ | 最短 8 位 |
| `displayName` | string | — | 显示名称，默认同 username |

**响应 201**

```json
{
  "userId": "usr_01HXK9...",
  "username": "alice",
  "token": "eyJhbGci..."
}
```

**示例**

```bash
curl -X POST http://localhost:19001/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"s3cr3tP@ss"}'
```

---

### POST /api/auth/login

用账号密码换取 JWT token。

**请求体**

```json
{
  "username": "alice",
  "password": "s3cr3tP@ss"
}
```

**响应 200**

```json
{
  "token": "eyJhbGci...",
  "expiresAt": 1743897600000
}
```

**示例**

```bash
curl -X POST http://localhost:19001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"s3cr3tP@ss"}'
```

---

### GET /api/auth/me

返回当前登录用户的账号信息（需鉴权）。

**响应 200**

```json
{
  "userId": "usr_01HXK9...",
  "username": "alice",
  "displayName": "Alice Chen",
  "createdAt": 1743811200000
}
```

**示例**

```bash
curl http://localhost:19001/api/auth/me \
  -H 'Authorization: Bearer eyJhbGci...'
```

---

## 聊天

### POST /api/chat/send

通过 Hub 中继发送一条消息到指定接收方。Hub 不解密消息内容（端到端加密）。

**请求体**

```json
{
  "to": "bob",
  "content": "encrypted-ciphertext-base64",
  "threadId": "thrd_01HXK9...",   // 可选，不传则创建新会话
  "contentType": "text"            // 可选，默认 "text"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `to` | string | ✅ | 接收方用户名或 userId |
| `content` | string | ✅ | 消息内容（加密后的 Base64 密文）|
| `threadId` | string | — | 会话 ID，不传时自动创建 |
| `contentType` | string | — | `text` \| `file` \| `task`，默认 `text` |

**响应 200**

```json
{
  "messageId": "msg_01HXK9...",
  "threadId": "thrd_01HXK9...",
  "deliveredAt": 1743811200000,
  "status": "delivered"            // "delivered" | "queued"（对方离线时）
}
```

**示例**

```ts
import { encrypt } from '@jackclaw/protocol'

const ciphertext = await encrypt(
  JSON.stringify({ text: 'Hi Bob!' }),
  bobPublicKey
)

const res = await fetch('http://localhost:19001/api/chat/send', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ to: 'bob', content: ciphertext }),
})
```

---

### GET /api/chat/inbox

拉取当前用户的未读消息（离线消息队列）。消息拉取后标记为已读并从队列移除。

**Query 参数**

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `limit` | number | 50 | 单次最多拉取条数（上限 200）|
| `since` | number | — | 只返回该时间戳之后的消息（Unix ms）|

**响应 200**

```json
{
  "messages": [
    {
      "messageId": "msg_01HXK9...",
      "from": "alice",
      "threadId": "thrd_01HXK9...",
      "content": "encrypted-ciphertext-base64",
      "contentType": "text",
      "sentAt": 1743811200000
    }
  ],
  "total": 1
}
```

**示例**

```bash
curl 'http://localhost:19001/api/chat/inbox?limit=20' \
  -H 'Authorization: Bearer eyJhbGci...'
```

---

### GET /api/chat/threads

获取当前用户的所有会话列表，按最近消息时间倒序排列。

**Query 参数**

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `page` | number | 1 | 页码 |
| `pageSize` | number | 20 | 每页条数（上限 100）|

**响应 200**

```json
{
  "threads": [
    {
      "threadId": "thrd_01HXK9...",
      "participants": ["alice", "bob"],
      "lastMessage": {
        "from": "bob",
        "contentType": "text",
        "sentAt": 1743811200000
      },
      "unreadCount": 3
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

**示例**

```bash
curl 'http://localhost:19001/api/chat/threads?pageSize=10' \
  -H 'Authorization: Bearer eyJhbGci...'
```

---

## 社交

### POST /api/social/send

向另一个用户发送社交消息（与聊天 API 不同，社交消息不要求端到端加密，适合公开通知/广播）。

**请求体**

```json
{
  "to": "bob",
  "message": "Hello from Alice!",
  "type": "notification"    // 可选，默认 "message"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `to` | string | ✅ | 接收方用户名 |
| `message` | string | ✅ | 消息正文（纯文本，最长 2000 字符）|
| `type` | string | — | `message` \| `notification` \| `invite` |

**响应 200**

```json
{
  "socialMessageId": "sm_01HXK9...",
  "sentAt": 1743811200000,
  "status": "sent"
}
```

**示例**

```bash
curl -X POST http://localhost:19001/api/social/send \
  -H 'Authorization: Bearer eyJhbGci...' \
  -H 'Content-Type: application/json' \
  -d '{"to":"bob","message":"Hello from Alice!"}'
```

---

## 在线状态

### GET /api/presence/online

返回当前在线的用户列表（最近 5 分钟内有活动的用户）。

**Query 参数**

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `filter` | string | — | 按用户名前缀过滤 |
| `limit` | number | 100 | 最多返回条数 |

**响应 200**

```json
{
  "online": [
    {
      "username": "bob",
      "userId": "usr_01HXK9...",
      "lastSeenAt": 1743811200000,
      "status": "active"   // "active" | "idle"
    }
  ],
  "total": 1,
  "asOf": 1743811260000
}
```

**示例**

```bash
curl 'http://localhost:19001/api/presence/online?filter=b' \
  -H 'Authorization: Bearer eyJhbGci...'
```

---

## 错误响应

所有接口使用统一错误格式：

```json
{
  "error": "unauthorized",
  "message": "JWT token missing or expired"
}
```

| HTTP 状态码 | error | 说明 |
|------------|-------|------|
| 400 | `validation_failed` | 请求体字段缺失或格式错误 |
| 401 | `unauthorized` | JWT 缺失或过期 |
| 403 | `forbidden` | 无权操作该资源 |
| 404 | `not_found` | 资源不存在 |
| 409 | `conflict` | 用户名已被注册等冲突 |
| 429 | `rate_limited` | 请求过于频繁 |
| 500 | `internal_error` | 服务器内部错误 |
