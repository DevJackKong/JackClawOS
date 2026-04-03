# JackClaw 系统架构

## 概览

JackClaw 采用 **Hub-and-Node** 拓扑。Hub 是轻量级协调中心，Node 是每个成员本地运行的智能体运行时。两者通过 REST API 和 WebSocket 通信。

```
                        ┌─────────────────────────────────────────────────┐
                        │                   JackClaw Hub                    │
                        │                                                   │
                        │   ┌───────────┐  ┌────────────┐  ┌───────────┐  │
                        │   │  Registry │  │  Dispatcher│  │  Reports  │  │
                        │   │           │  │            │  │  Store    │  │
                        │   │ node list │  │ task queue │  │           │  │
                        │   │ heartbeat │  │ broadcast  │  │ summaries │  │
                        │   └───────────┘  └────────────┘  └───────────┘  │
                        │                                                   │
                        │   ┌───────────────────────────────────────────┐  │
                        │   │             Auth Middleware                │  │
                        │   │  JWT verify · Rate limit · TLS termination│  │
                        │   └───────────────────────────────────────────┘  │
                        │                                                   │
                        │   Port: 19001  (HTTP/WS)                         │
                        └──────┬────────────────────┬──────────────────────┘
                               │  HTTPS / WSS        │
                    ┌──────────▼──────────┐   ┌──────▼──────────────┐
                    │    Node: Member A    │   │   Node: Member B    │
                    │                     │   │                     │
                    │  ┌───────────────┐  │   │  ┌───────────────┐  │
                    │  │ Agent Runtime │  │   │  │ Agent Runtime │  │
                    │  │  - LLM calls  │  │   │  │  - LLM calls  │  │
                    │  │  - Tool exec  │  │   │  │  - Tool exec  │  │
                    │  └───────┬───────┘  │   │  └───────┬───────┘  │
                    │          │          │   │          │          │
                    │  ┌───────▼───────┐  │   │  ┌───────▼───────┐  │
                    │  │   Scheduler   │  │   │  │   Scheduler   │  │
                    │  │  cron-based   │  │   │  │  cron-based   │  │
                    │  │  reporting    │  │   │  │  reporting    │  │
                    │  └───────┬───────┘  │   │  └───────┬───────┘  │
                    │          │          │   │          │          │
                    │  ┌───────▼───────┐  │   │  ┌───────▼───────┐  │
                    │  │ Local Storage │  │   │  │ Local Storage │  │
                    │  │  Raw context  │  │   │  │  Raw context  │  │
                    │  │  (stays here) │  │   │  │  (stays here) │  │
                    │  └───────────────┘  │   │  └───────────────┘  │
                    │                     │   │                     │
                    │  Port: 19000        │   │  Port: 19000        │
                    └─────────────────────┘   └─────────────────────┘
```

---

## 组件详解

### Hub

| 模块 | 职责 |
|------|------|
| **Registry** | 维护在线节点列表，处理心跳，管理节点元数据 |
| **Dispatcher** | 接收任务，路由到目标节点，追踪执行状态 |
| **Reports Store** | 存储节点上报的摘要，支持按时间/成员查询 |
| **Auth Middleware** | JWT 验证、请求频率限制、审计日志 |

Hub 是**无状态可选**的：Hub 故障不影响各 Node 的本地运行，仅影响跨节点协调。

### Node

| 模块 | 职责 |
|------|------|
| **Agent Runtime** | 执行 AI 指令、工具调用、上下文管理 |
| **Scheduler** | Cron 驱动的定时汇报，支持 `REPORT_SCHEDULE` 配置 |
| **Local Storage** | 原始上下文、工具结果、会话历史（不离开本机） |
| **Hub Client** | 管理到 Hub 的 WebSocket 长连接，自动重连 |

### Protocol（共享类型）

```
packages/protocol/
├── src/
│   ├── messages.ts    # Hub ↔ Node 消息结构
│   ├── reports.ts     # 汇报数据结构
│   ├── tasks.ts       # 任务分发结构
│   └── index.ts
```

---

## 数据流

### 节点汇报流程

```
Node Scheduler
    │
    ├─ 1. 读取本地上下文（今日活动摘要）
    │
    ├─ 2. 按 REPORT_VISIBILITY 过滤
    │       summary_only → 只发标题+状态
    │       full         → 发完整内容
    │       private      → 不发送
    │
    ├─ 3. 签名 JWT payload
    │
    └─ 4. POST /api/reports → Hub Reports Store
```

### 任务分发流程

```
CLI / Owner Node
    │
    ├─ POST /api/tasks {target: "bob", instruction: "..."}
    │
Hub Dispatcher
    │
    ├─ 查找目标节点 WebSocket 连接
    ├─ 推送 TaskMessage
    │
Target Node Agent
    │
    ├─ 执行任务（本地）
    └─ 回调 POST /api/tasks/:id/result
```

---

## 部署模式

### 模式一：本地开发（双节点模拟）

```
localhost:19001  ←→  localhost:19000
     Hub                  Node
```

使用 `docker compose up -d` 即可启动。

### 模式二：云端 Hub + 多本地 Node

```
云服务器 Hub (hub.yourdomain.com:19001)
    ├── Alice 本地 Node (:19000)
    ├── Bob 本地 Node (:19000)
    └── Charlie 本地 Node (:19000)
```

Hub 配置 TLS 反代（Nginx / Caddy），各 Node 设置 `HUB_URL=https://hub.yourdomain.com`。

---

## 技术选型

| 层 | 技术 |
|---|---|
| 运行时 | Node.js ≥ 20 (ESM) |
| 语言 | TypeScript 5.x (strict) |
| HTTP框架 | Hono（轻量，边缘兼容）|
| WebSocket | ws |
| 认证 | jose (JWT RS256) |
| 存储 | SQLite (better-sqlite3) |
| 调度 | node-cron |
| 测试 | Vitest |
| 打包 | tsup |
