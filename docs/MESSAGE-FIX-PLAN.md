# 消息链路问题诊断 + 修复方案

> 基于实际代码审计（chat-worker.ts 467行 + message-store.ts + offline-queue.ts）

## 已发现的具体问题

### 问题 1：ws.send() 没有回调，不知道发没发成功

```ts
// chat-worker.ts:120 — 当前代码
ws.send(JSON.stringify({ event: 'message', data: msg }))
this.totalDelivered++  // ← 直接就算"已投递"，ws.send 可能还没完成
```

**修复**：用 ws.send 的 callback 确认发送结果。

### 问题 2：对端收到后没有 delivery ACK

```ts
// 当前：Hub 推到 WS 就算 delivered
// 实际：WS 到了 Node 的内核缓冲区，不代表 Node 进程收到了
// Node 端没有回复 delivery ACK 的代码
```

**修复**：Node 收到消息后回复 `{ type: 'delivery_ack', messageId }` 给 Hub。

### 问题 3：离线队列用 JSON 全量写入，不安全

```ts
// offline-queue.ts:52
private _persist(): void {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(this.queue, null, 2), 'utf-8')
  // ← 如果写到一半进程崩了，整个文件坏掉，所有离线消息丢失
}
```

**修复**：改用追加写入 + 定期压缩。

### 问题 4：ChatStore.saveMessage 只存内存 Map

```ts
// store/chat.ts — saveMessage 先写 Map，异步写 messageStore
// 进程崩溃 = Map 里的消息全丢
```

**修复**：先持久化再投递，顺序不能反。

### 问题 5：SQLite binding 缺失，用 JSONL fallback

```
[message-store] SQLite unavailable (Could not locate the bindings file...)
using JSONL fallback: ~/.jackclaw/hub/messages.jsonl
```

JSONL fallback 的 `_rewrite()` 把整个消息列表全量重写文件，消息多了以后是 O(n) 写入。

**修复**：换 better-sqlite3 为 `@libsql/client` 或重新编译 native binding。

### 问题 6：发送方收到的状态不准

```ts
// chat-worker.ts:90 — handleIncoming 里
this.pushEvent(msg.from, 'receipt', { messageId: msg.id, status: 'sent', ... })
// ← 这里 status='sent' 表示"Hub 收到了"，但用的词是 'sent'
//    对用户来说 'sent' = "已发送到对方"，实际只是 Hub 存了

// chat-worker.ts:122 — deliver 里
this.pushEvent(msg.from, 'receipt', { messageId: msg.id, status: 'delivered', ... })
// ← ws.send 没有等 callback，也没等 Node ACK，就算 delivered
```

**修复**：状态语义对齐，accepted ≠ sent ≠ delivered。

### 问题 7：无重试机制

```ts
// deliver() 里：WS 不在线 → 直接进离线队列，没有重试
// 如果 WS 是瞬时断开（网络抖动），消息会延迟到 Node 下次重连
```

**修复**：增加即时重试（500ms 后重试 1 次）。

### 问题 8：无去重保护

```ts
// handleIncoming() 每次调用都 saveMessage + 投递
// 如果客户端重试发送同一 messageId，Hub 会重复处理
```

**修复**：messageId 去重检查。

## 最小修复方案（不重构架构，在现有代码上改）

### 改动 1：ws.send 加 callback

```ts
// chat-worker.ts deliver() 方法
deliver(target: string, msg: ChatMessage): void {
  if (isHumanTarget(target)) {
    this._deliverToHuman(target, msg)
    return
  }

  const ws = this.wsClients.get(target)
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event: 'message', data: msg }), (err) => {
      if (err) {
        // WS 发送失败 → 即时重试 1 次
        console.warn(`[chat-worker] ws.send failed for ${target}: ${err.message}`)
        setTimeout(() => this._retryDeliver(target, msg), 500)
      } else {
        this.totalDelivered++
        // 此时只是"已推送到 WS"，不是"对方已收到"
        this.pushEvent(msg.from, 'receipt', {
          messageId: msg.id, status: 'sent', nodeId: target, ts: Date.now()
        })
        // 启动 ACK 超时计时器
        this._startAckTimer(msg.id, target, msg)
      }
    })
  } else {
    this._queueOffline(target, msg)
  }
}
```

### 改动 2：Node 端 delivery ACK

```ts
// Node 收到消息后自动回复
ws.on('message', (raw) => {
  const envelope = JSON.parse(raw.toString())
  
  if (envelope.event === 'message') {
    // 立即回复 delivery ACK
    ws.send(JSON.stringify({
      type: 'delivery_ack',
      messageId: envelope.data.id,
      ts: Date.now()
    }))
    // 然后处理消息...
  }
})
```

### 改动 3：Hub 处理 delivery ACK

```ts
// chat-worker.ts — WS message handler 里增加
ws.on('message', (raw) => {
  const parsed = JSON.parse(raw.toString())

  // 处理 delivery ACK
  if (parsed.type === 'delivery_ack') {
    this._handleDeliveryAck(parsed.messageId, nodeId)
    return
  }
  
  // 原有逻辑...
})

private _ackTimers = new Map<string, NodeJS.Timeout>()

private _startAckTimer(messageId: string, target: string, msg: ChatMessage): void {
  const timer = setTimeout(() => {
    // 3秒没收到 ACK → 进离线队列
    console.warn(`[chat-worker] delivery ACK timeout for ${messageId} to ${target}`)
    this._ackTimers.delete(messageId)
    this._queueOffline(target, msg)
    this.pushEvent(msg.from, 'receipt', {
      messageId, status: 'queued',
      reason: '对方未确认收到，已转离线队列',
      ts: Date.now()
    })
  }, 3000)
  this._ackTimers.set(messageId, timer)
}

private _handleDeliveryAck(messageId: string, fromNode: string): void {
  const timer = this._ackTimers.get(messageId)
  if (timer) {
    clearTimeout(timer)
    this._ackTimers.delete(messageId)
  }
  // 通知发送方：对方已确认收到
  const msg = this.store.getMessage(messageId)
  if (msg) {
    this.pushEvent(msg.from, 'receipt', {
      messageId, status: 'delivered', nodeId: fromNode, ts: Date.now()
    })
  }
}
```

### 改动 4：离线队列改追加写入

```ts
// offline-queue.ts — 改 _persist 为追加写入
enqueue(targetHandle: string, message: QueuedEnvelope): void {
  const key = this._key(targetHandle)
  const q = this.queue[key] ?? []
  q.push(message)
  this.queue[key] = q
  // 追加写入，不全量重写
  fs.appendFileSync(this.walFile, JSON.stringify({ key, message }) + '\n')
}

// 定期压缩 WAL
private _compact(): void {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(this.queue, null, 2))
  if (fs.existsSync(this.walFile)) fs.unlinkSync(this.walFile)
}
```

### 改动 5：发送前去重

```ts
// chat-worker.ts — handleIncoming 开头加去重
private _recentIds = new Map<string, number>()  // messageId → timestamp
private readonly DEDUPE_TTL = 60_000             // 1 分钟内去重

handleIncoming(msg: ChatMessage): void {
  // 去重检查
  if (this._recentIds.has(msg.id)) {
    // 已处理过，返回之前的状态
    this.pushEvent(msg.from, 'receipt', {
      messageId: msg.id, status: 'duplicate', ts: Date.now()
    })
    return
  }
  this._recentIds.set(msg.id, Date.now())
  
  // 定期清理
  if (this._recentIds.size > 10000) {
    const cutoff = Date.now() - this.DEDUPE_TTL
    for (const [id, ts] of this._recentIds) {
      if (ts < cutoff) this._recentIds.delete(id)
    }
  }

  // 原有逻辑...
  this.totalReceived++
  this.store.saveMessage(msg)
  // ...
}
```

### 改动 6：即时重试

```ts
private _retryDeliver(target: string, msg: ChatMessage): void {
  const ws = this.wsClients.get(target)
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event: 'message', data: msg }), (err) => {
      if (err) {
        // 重试也失败 → 进离线队列
        this._queueOffline(target, msg)
      } else {
        this.totalDelivered++
        this.pushEvent(msg.from, 'receipt', {
          messageId: msg.id, status: 'sent', nodeId: target, ts: Date.now()
        })
        this._startAckTimer(msg.id, target, msg)
      }
    })
  } else {
    this._queueOffline(target, msg)
  }
}

private _queueOffline(target: string, msg: ChatMessage): void {
  this.store.queueForOffline(target, msg)
  this.totalQueued++
  this.pushEvent(msg.from, 'receipt', {
    messageId: msg.id, status: 'queued',
    reason: '对方不在线，上线后自动送达',
    ts: Date.now()
  })
  setImmediate(() => {
    void pushService.push(target, {
      title: `New message from ${msg.from}`,
      body: (typeof msg.content === 'string'
        ? msg.content : JSON.stringify(msg.content)).slice(0, 120),
      data: { type: 'chat', messageId: msg.id, from: msg.from },
    })
  })
}
```

### 改动 7：修 SQLite

```bash
# 方案 A：重新编译 better-sqlite3
cd packages/hub && npm rebuild better-sqlite3

# 方案 B：换成 @libsql/client（纯 JS，不需要 native binding）
npm install @libsql/client
# 然后改 message-store.ts 的 import
```

## 状态语义修正

| 状态 | 之前含义 | 修正后含义 |
|------|----------|------------|
| **'sent'** | Hub 收到了（误导） | Hub 已推送到 WS |
| **'delivered'** | ws.send 调了（不准） | Node 回复了 delivery ACK |
| **'queued'** | （不存在） | 进了离线队列 |
| **新增 'accepted'** | （不存在） | Hub 收到并持久化 |

## 改动量评估

| 文件 | 改动 | 行数 |
|------|------|------|
| chat-worker.ts | 加 ACK 计时器 + 重试 + 去重 | ~80 行 |
| Node WS handler | 加 delivery ACK | ~10 行 |
| offline-queue.ts | 改追加写入 | ~20 行 |
| message-store.ts | 换 SQLite 实现 | ~30 行 |
| protocol/receipt.ts | 加 'accepted' 和 'queued' | ~5 行 |
| **总计** | | **~145 行** |

**不重构架构，145 行代码修复 8 个问题。**
