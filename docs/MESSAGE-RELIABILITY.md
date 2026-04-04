# 消息可靠性系统级解决方案

> 目标：从"能发消息"升级到"消息系统靠谱"——可确认、可重试、可回退、可观测。

## 一、现状问题

### 当前消息链路

```
发送方 → Hub REST /chat/send → ChatWorker.handleIncoming()
  → store.saveMessage()（内存 Map + JSONL fallback）
  → deliver()
    → WS online? → ws.send() → 完
    → WS offline? → store.queueForOffline() → Web Push
```

### 具体问题

| 问题 | 原因 | 后果 |
|------|------|------|
| **看起来发了，其实没到** | `/chat/send` 只要 Hub 收到就返回 200，不等 delivery | 发送方以为成功 |
| **不知道卡在哪** | 无分阶段状态，只有 'sent' 和 'delivered' | 无法诊断 |
| **WS 断了不知道** | 依赖 ping/pong 心跳，间隔 30s | 30s 窗口内消息丢失 |
| **离线队列不可靠** | JSON 文件持久化，无 WAL | 进程崩溃可能丢数据 |
| **无重试机制** | deliver 失败直接进离线队列，不重试 | 临时网络抖动 = 消息延迟 |
| **无幂等保护** | messageId 只做存储 key，不做去重 | 重试可能重复 |
| **无 ACK 机制** | 对端收到不确认 | 永远不知道对方是否真的收到 |

## 二、消息状态机

### 2.1 五阶段生命周期

```
accepted → sent → delivered → acked → read
  ↓         ↓        ↓
failed   failed    expired
```

| 状态 | 含义 | 触发条件 |
|------|------|----------|
| **accepted** | Hub 收到并持久化 | REST API 写入成功 |
| **sent** | Hub 已推送到目标 WS | ws.send() callback 无错误 |
| **delivered** | 目标 Node 进程收到 | Node 返回 delivery ACK |
| **acked** | 目标 Agent 已处理 | Agent 返回 processing ACK |
| **read** | 目标人类已查看 | 客户端发送 read receipt |
| **failed** | 任一阶段失败 | 超时/错误/权限拒绝 |
| **expired** | 离线队列 TTL 到期 | 消息在队列中超过 TTL |

### 2.2 状态转移图

```
            ┌─────────┐
   发送方 → │ accepted │ ← Hub 持久化完成
            └────┬────┘
                 │ ws.send()
            ┌────▼────┐
            │  sent    │ ← Hub 推送到 WS
            └────┬────┘
                 │ Node delivery ACK（3s 超时）
            ┌────▼──────┐
            │ delivered  │ ← Node 进程确认收到
            └────┬──────┘
                 │ Agent processing ACK（可选）
            ┌────▼────┐
            │  acked   │ ← Agent 确认已处理
            └────┬────┘
                 │ 客户端 read receipt
            ┌────▼────┐
            │  read    │ ← 人类已读
            └─────────┘

任一阶段超时/失败 → failed（带失败原因分类）
```

## 三、失败原因分类

### 3.1 错误码体系

```ts
type DeliveryFailureReason =
  // 路由阶段
  | 'HANDLE_NOT_FOUND'           // handle 解析失败
  | 'HANDLE_NO_NODE'             // handle 存在但未绑定 node
  | 'NODE_NOT_REGISTERED'        // nodeId 未在 Hub 注册
  
  // 连接阶段
  | 'NODE_OFFLINE'               // node 不在线
  | 'WS_DISCONNECTED'            // WebSocket 已断开
  | 'WS_SEND_ERROR'              // ws.send() 抛错
  | 'WS_BACKPRESSURE'            // WS 缓冲区满
  
  // 确认阶段
  | 'DELIVERY_ACK_TIMEOUT'       // 3s 内未收到 delivery ACK
  | 'PROCESSING_ACK_TIMEOUT'     // Agent 处理超时
  | 'RECIPIENT_REJECTED'         // 对端主动拒收（权限/黑名单）
  
  // 存储阶段
  | 'STORE_WRITE_FAILED'         // 持久化失败
  | 'QUEUE_FULL'                 // 离线队列满
  | 'MESSAGE_EXPIRED'            // TTL 过期
  
  // 认证阶段
  | 'AUTH_INVALID_JWT'           // JWT 无效
  | 'AUTH_EXPIRED'               // JWT 过期
  | 'AUTH_INSUFFICIENT'          // 权限不足
  
  // 联邦阶段
  | 'FEDERATION_HUB_UNREACHABLE' // 远程 Hub 不可达
  | 'FEDERATION_SIGNATURE_INVALID' // 签名验证失败
  | 'FEDERATION_RATE_LIMITED'    // 被限流
```

### 3.2 错误响应结构

```ts
interface DeliveryReport {
  messageId: string
  status: MessageLifecycleStatus
  failureReason?: DeliveryFailureReason
  failureDetail?: string          // 人类可读说明
  attempts: number                // 已重试次数
  lastAttemptAt: number           // 最后尝试时间
  nextRetryAt?: number            // 下次重试时间（如果排队中）
  route: {
    fromNode: string
    toHandle: string
    toNode?: string
    viaHub?: string               // 联邦路由经过的 Hub
  }
}
```

## 四、重试策略

### 4.1 分级重试

```ts
interface RetryPolicy {
  // 即时重试（WS 发送失败，可能是瞬时抖动）
  immediate: {
    maxAttempts: 2
    backoffMs: 500                // 500ms 后重试
  }
  
  // 短期重试（Node 在线但未 ACK）
  short: {
    maxAttempts: 3
    backoffMs: [1000, 3000, 10000]  // 指数退避
  }
  
  // 离线重投（Node 下线后重新上线时）
  offline: {
    maxAttempts: 10
    ttlMs: 7 * 24 * 60 * 60 * 1000  // 7 天
    retryOnReconnect: true
  }
  
  // 联邦重试（跨 Hub 投递失败）
  federation: {
    maxAttempts: 5
    backoffMs: [5000, 15000, 60000, 300000, 600000]  // 最长 10 分钟
  }
}
```

### 4.2 幂等保护

```ts
// Hub 维护 messageId 去重表
interface DedupeCache {
  // 写入时检查：如果 messageId 已存在，返回已有的 DeliveryReport
  check(messageId: string): DeliveryReport | null
  
  // 标记为已处理
  mark(messageId: string, report: DeliveryReport): void
  
  // TTL：24 小时后自动清理
  ttlMs: 24 * 60 * 60 * 1000
}

// 发送方重试时携带相同 messageId
// Hub 自动去重，不会重复投递
```

## 五、ACK 协议

### 5.1 三层 ACK

```
Layer 1: Delivery ACK（传输层）
  Node 进程收到 WS 消息后立即回复
  超时：3 秒
  格式：{ type: 'ack', messageId, level: 'delivery', ts }

Layer 2: Processing ACK（应用层）
  Agent 处理完消息后回复
  超时：30 秒（LLM 调用可能慢）
  格式：{ type: 'ack', messageId, level: 'processing', ts }

Layer 3: Read Receipt（用户层）
  人类在客户端查看后回复
  无超时（可能很久以后才看）
  格式：{ type: 'ack', messageId, level: 'read', ts }
```

### 5.2 ACK 超时处理

```
Delivery ACK 超时（3s）：
  → 标记 WS 为可疑
  → 即时重试 1 次
  → 仍失败 → 进离线队列 + 标记 status: 'queued'

Processing ACK 超时（30s）：
  → 不重试（可能 Agent 在执行长任务）
  → 标记 status: 'delivered_unprocessed'
  → 通知发送方："消息已送达，对方 Agent 处理中"

Read Receipt 永不超时：
  → 状态停留在 'acked' 直到收到 read receipt
```

## 六、离线队列重构

### 6.1 从 JSON 文件 → WAL 持久化

```ts
// 当前：整个队列 JSON.stringify() 写入文件（不安全）
// 改为：追加写入 + 定期压缩

interface ReliableOfflineQueue {
  // 追加写入（崩溃安全）
  enqueue(target: string, envelope: QueuedEnvelope): void
  // 先写 WAL → 再更新内存 → 后台压缩

  // 原子性出队
  dequeue(target: string): QueuedEnvelope[]
  // 标记为已投递 → 后台清理

  // 投递状态
  status(target: string): {
    pending: number
    oldestTs: number
    totalSize: number
  }

  // TTL 清理
  gc(): { expired: number; removed: number }
}
```

### 6.2 容量保护

```ts
interface QueueLimits {
  maxPerTarget: 1000              // 每个 handle 最多 1000 条
  maxTotalSize: 100 * 1024 * 1024 // 总共 100MB
  messageTtl: 7 * 24 * 60 * 60 * 1000  // 7 天
  
  // 超限策略
  onFull: 'drop_oldest' | 'reject_new'
}
```

## 七、可观测性

### 7.1 投递状态查询 API

```
GET /api/chat/delivery/:messageId
→ {
    messageId: "xxx",
    status: "delivered",
    timeline: [
      { status: "accepted", ts: 1712345600000 },
      { status: "sent", ts: 1712345600050, target: "node-abc" },
      { status: "delivered", ts: 1712345600120, ackFrom: "node-abc" }
    ],
    attempts: 1,
    route: { from: "@alice", to: "@bob", viaHub: null }
  }

GET /api/chat/delivery/status?from=@alice&limit=20
→ 最近 20 条消息的投递状态
```

### 7.2 实时推送投递状态

```ts
// 发送方的 WS 会收到投递状态更新
ws.on('message') → {
  event: 'delivery_status',
  data: {
    messageId: "xxx",
    status: "delivered",       // 或 "failed"
    failureReason?: "NODE_OFFLINE",
    ts: 1712345600120
  }
}
```

### 7.3 Dashboard 指标

```
消息总量：今日/本周/本月
投递成功率：98.5%
平均投递延迟：120ms
离线队列深度：23 条
失败原因分布：
  NODE_OFFLINE: 45%
  WS_DISCONNECTED: 30%
  DELIVERY_ACK_TIMEOUT: 15%
  其他: 10%
```

## 八、实现路径

### 改动范围

```
packages/protocol/src/
  + reliability.ts              // 新增：状态机 + 错误码 + ACK 类型
  ~ types.ts                    // 扩展 MessageStatus

packages/hub/src/
  + reliability/
    + delivery-tracker.ts       // 投递追踪器（状态机）
    + retry-scheduler.ts        // 重试调度器
    + dedupe-cache.ts           // 幂等去重
    + ack-manager.ts            // ACK 超时管理
  ~ chat-worker.ts              // 改造投递流程
  ~ store/offline-queue.ts      // WAL 持久化重构
  + routes/delivery.ts          // 投递状态查询 API

packages/node/src/
  + ack-responder.ts            // 自动回复 delivery/processing ACK

packages/pwa/
  + 投递状态 UI                   // 消息气泡下的状态图标
```

### 与 EventBus 的关系

```
delivery-tracker 发出事件 → EventBus 分发 → Plugin 订阅

message.accepted  → 存储
message.sent      → 开始 ACK 计时
message.delivered → 清除重试 + 通知发送方
message.acked     → 清除 processing 计时
message.failed    → 重试调度 or 通知发送方
message.expired   → GC 清理 + 通知发送方
```

## 九、改造前后对比

| 维度 | 改造前 | 改造后 |
|------|--------|--------|
| 发送确认 | HTTP 200 = "Hub 收到了" | 5 级状态：accepted→sent→delivered→acked→read |
| 失败处理 | 直接进离线队列 | 即时重试 → 短期退避 → 离线队列 → TTL 过期 |
| 失败原因 | 无 | 15+ 分类错误码 |
| 幂等性 | 无 | messageId 去重（24h TTL） |
| ACK 机制 | 无 | 3 层 ACK（delivery / processing / read） |
| 离线队列 | JSON 文件全量写 | WAL 追加 + 原子出队 + TTL + 容量限制 |
| 可观测性 | 无 | API + WS 推送 + Dashboard 指标 |
| 重试 | 无 | 分级重试 + 指数退避 |

## 十、一句话

> **消息不再是"发出去就不管了"。每条消息都有完整的生命周期追踪，失败了知道为什么失败，重试了知道重试几次，对方收没收到有明确的 ACK 确认。从黑盒变成白盒。**
