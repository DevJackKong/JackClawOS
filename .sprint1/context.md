# Sprint 1 任务上下文（模型切换恢复用）

## 项目位置
- Monorepo: `/Users/jack/Documents/mack/orgclaw`
- Hub: `packages/hub/`
- Node: `packages/node/`
- Protocol: `packages/protocol/`
- CLI: `packages/cli/`

## Sprint 1 任务清单（6 个任务）

### Task 1: 统一消息状态机
- 文件: `packages/protocol/src/chat.ts`
- 改动: MessageStatus 枚举改为 6 态 accepted→sent→acked→stored→consumed→failed
- 所有引用处同步更新

### Task 2: SQLite 持久化修复
- 文件: `packages/hub/src/store/message-store.ts`
- 状态: ✅ 已完成 sql.js 替代 better-sqlite3
- 待做: Node 端也需要 local store

### Task 3: Delivery ACK + 重试
- 文件: `packages/hub/src/chat-worker.ts`
- 改动: ws.send 加 callback + delivery_ack 事件 + 3s 超时 + 500ms 重试

### Task 4: 消息去重
- 文件: `packages/hub/src/chat-worker.ts`
- 改动: messageId + 60s 滑动窗口

### Task 5: 离线队列 WAL
- 文件: `packages/hub/src/store/offline-queue.ts`
- 改动: writeFileSync 全量 → appendFileSync WAL + 原子 rename

### Task 6: 消息追踪 API
- 文件: `packages/hub/src/routes/chat.ts` (新增路由)
- 改动: GET /message/:id/status + GET /message/:id/trace

## 已完成
- [x] Task 2 部分完成（message-store.ts sql.js 重写）

## 环境注意
- Node 25, npm, TypeScript
- better-sqlite3 编译失败，必须用 sql.js
- Claude Code 登录过期，用直接文件编辑
