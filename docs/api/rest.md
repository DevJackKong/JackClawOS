# Hub REST API 参考

源码入口：

- 路由装配：`packages/hub/src/server.ts`
- 路由目录：`packages/hub/src/routes/`

## Base URL

默认：

```text
http://localhost:3100
```

## 鉴权规则

根据 `server.ts`：

### 无需 JWT 的公开接口

- `/health`
- `/.well-known`
- `/api/register`
- `/api/auth/*`
- `/api/chat/*`
- `/api/humans/*`
- `/api/receipt/*`
- `/api/federation/*`
- `/api/agent/*`
- `/` 下 profile page
- `/api/memory/*`

### 需要 JWT 的接口

其余 `/api/*` 基本都走 `jwtAuthMiddleware`。

请求头：

```http
Authorization: Bearer <token>
```

## 核心服务入口

`packages/hub/src/index.ts` 启动时明确暴露：

- `POST /api/register`
- `POST /api/report`
- `GET /api/nodes`
- `GET /api/summary`
- `POST /api/chat/send`
- `POST /api/agent/session`
- `GET /api/chat/inbox`
- `WS /chat/ws`
- `POST /api/ask`
- `GET /health`

---

## 路由总表

以下按 `packages/hub/src/routes/` 中实际文件列出。

### agent-card.ts → `/.well-known`

- `GET /.well-known/agents.json`
- `GET /.well-known/agents/:handle`

用途：Agent Card / A2A / OpenAgents 发现。

### agent-session.ts → `/api/agent`

- `POST /api/agent/session`

用途：Agent Session Protocol。

### approval.ts → `/api/approvals`

- `POST /api/approvals/`
- `GET /api/approvals/`

用途：审批请求列表与创建。

### ask.ts → `/api/ask`

- `GET /api/ask/providers`
- `POST /api/ask/`

用途：通过 Hub 访问任意可用模型。

### audit.ts → `/api/audit`

- `POST /api/audit/`
- `GET /api/audit/`

用途：审计日志写入与查询。

### auth.ts → `/api/auth`

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/check-handle`
- `GET /api/auth/me`
- `PATCH /api/auth/profile`
- `POST /api/auth/change-password`
- `GET /api/auth/users`
- `POST /api/auth/invite`

用途：账号注册、登录、个人资料、用户列表与邀请。

### channels.ts → `/api/channels`

- `GET /api/channels/`
- `POST /api/channels/configure`
- `GET /api/channels/stats`

用途：聚合渠道状态与配置。

### chat-context.ts → `/api/chat-context`

- `GET /api/chat-context/:nodeId`

用途：查询某个节点的聊天上下文。

### chat.ts → `/api/chat`

- `POST /api/chat/send`
- `GET /api/chat/inbox`
- `GET /api/chat/threads`
- `GET /api/chat/thread/:id`
- `POST /api/chat/thread`
- `POST /api/chat/group/create`
- `GET /api/chat/groups`
- `POST /api/chat/human/register`
- `GET /api/chat/humans`

用途：ClawChat 消息、线程、群组、人类注册。

### config.ts → `/api/config`

- `GET /api/config/`
- `GET /api/config/:key/effective`

用途：读取配置及某个 key 的最终生效值。

### contacts.ts → `/api/contacts`

- `POST /api/contacts/`
- `GET /api/contacts/`

用途：联系人管理。

### dashboard.ts → `/api/dashboard`

- `GET /api/dashboard/overview`

用途：Dashboard 概览数据。

### directory.ts → `/api/directory`

- `POST /api/directory/register`
- `GET /api/directory/lookup/:handle`
- `GET /api/directory/list`

用途：Handle 注册、查找、目录列表。

### federation.ts → `/api/federation`

- `POST /api/federation/handshake`
- `POST /api/federation/message`
- `GET /api/federation/peers`
- `POST /api/federation/discover`
- `GET /api/federation/status`
- `POST /api/federation/blacklist`

用途：跨 Hub 联邦通信。

### files.ts → `/api/files`

- `POST /api/files/upload`
- `GET /api/files/list`
- `GET /api/files/:fileId/thumb`
- `GET /api/files/:fileId`
- `DELETE /api/files/:fileId`

用途：上传、列出、下载、缩略图、删除文件。

### groups.ts → `/api/groups`

- `POST /api/groups/join/:inviteCode`
- `POST /api/groups/create`
- `GET /api/groups/list`
- `GET /api/groups/:id`

用途：群组创建与加入。

### health.ts → `/health`

- `GET /health/`
- `GET /health/detailed`
- `GET /health/metrics`

用途：健康检查与指标。

### human-review.ts → `/api/review`

- `POST /api/review/request`
- `GET /api/review/pending`
- `POST /api/review/resolve/:requestId`

用途：人类在环审批。

### humans.ts → `/api/humans`

- `POST /api/humans/register`
- `GET /api/humans/`
- `POST /api/humans/message`

用途：人类账号注册与消息发送。

### interaction-trace.ts → `/api/traces`

- `GET /api/traces/`
- `GET /api/traces/:id`
- `GET /api/traces/:id/chain`
- `POST /api/traces/`

用途：交互链路追踪。

### members.ts → `/api/members`

- `POST /api/members/`
- `GET /api/members/`
- `PATCH /api/members/:id`
- `DELETE /api/members/:id`

用途：组织成员 CRUD。

### memory.ts → `/api/memory`

- `GET /api/memory/org`
- `POST /api/memory/broadcast`
- `POST /api/memory/skills`
- `GET /api/memory/experts`
- `POST /api/memory/collab/init`
- `POST /api/memory/collab/:id/sync`
- `POST /api/memory/collab/:id/end`
- `POST /api/memory/push`

用途：组织记忆、技能广播、协作会话、跨节点记忆同步。

### moltbook.ts → `/api/moltbook`

- `POST /api/moltbook/connect`
- `GET /api/moltbook/status`
- `POST /api/moltbook/post`
- `GET /api/moltbook/feed`
- `POST /api/moltbook/sync`
- `GET /api/moltbook/digest`

用途：Moltbook 社交集成。

### nodes.ts → `/api/nodes`

- `GET /api/nodes/`
- `POST /api/nodes/:nodeId/workload`

用途：节点列表与工作负载汇报。

### notifications.ts → `/api/notifications`

- `GET /api/notifications/`
- `GET /api/notifications/unread-count`
- `POST /api/notifications/read-all`
- `GET /api/notifications/:id`

用途：通知读取与未读数。

### org-memory.ts → `/api/org-memory`

- `GET /api/org-memory/`
- `GET /api/org-memory/search`
- `GET /api/org-memory/:id`
- `POST /api/org-memory/`
- `DELETE /api/org-memory/:id`

用途：组织级记忆库 CRUD。

### org-norm.ts → `/api/org-norm`

- `GET /api/org-norm/`
- `POST /api/org-norm/`
- `PUT /api/org-norm/:id`
- `DELETE /api/org-norm/:id`

用途：组织规范管理。

### org.ts → `/api/orgs`

- `POST /api/orgs/`
- `GET /api/orgs/`
- `GET /api/orgs/:id`
- `PATCH /api/orgs/:id`

用途：组织实体 CRUD。

### payment.ts → `/api/payment`

- `POST /api/payment/submit`
- `GET /api/payment/pending`
- `POST /api/payment/approve/:requestId`
- `POST /api/payment/reject/:requestId`
- `GET /api/payment/audit/:nodeId`

用途：支付审批流。

### plan.ts → `/api/plan`

- `POST /api/plan/estimate`

用途：任务估算。

### plugins.ts → `/api/plugins`

- `GET /api/plugins/`
- `GET /api/plugins/:id`
- `POST /api/plugins/:id/enable`
- `POST /api/plugins/:id/disable`
- `DELETE /api/plugins/:id`

用途：插件查询、启停、删除。

### presence.ts → `/api/presence`

- `GET /api/presence/online`
- `GET /api/presence/:handle`

用途：在线状态查询。

### profile-page.ts → `/`

- `GET /@:handle`

用途：公开个人资料页。

### push.ts → `/api/push`

- `GET /api/push/vapid-key`
- `POST /api/push/subscribe`
- `POST /api/push/unsubscribe`
- `POST /api/push/test`

用途：Web Push。

### receipt.ts → `/api/receipt`

- `POST /api/receipt/delivered`
- `POST /api/receipt/read`
- `POST /api/receipt/read-batch`
- `POST /api/receipt/typing`
- `GET /api/receipt/status/:messageId`

用途：送达、已读、输入中、状态查询。

### register.ts → `/api/register`

- `POST /api/register/`

用途：节点注册。

### report.ts → `/api/reports`

- `POST /api/reports/`

注意：启动日志写的是 `/api/report`，而 `server.ts` 实际挂载为 `/api/reports`。

### risk.ts → `/api/risk`

- `POST /api/risk/evaluate`
- `GET /api/risk/rules`
- `POST /api/risk/rules`
- `DELETE /api/risk/rules/:id`

用途：风险引擎与规则管理。

### roles.ts → `/api/roles`

- `POST /api/roles/`
- `GET /api/roles/`
- `GET /api/roles/user/:userId`

用途：角色管理。

### search.ts → `/api/search`

- `GET /api/search/messages`
- `GET /api/search/contacts`

用途：消息与联系人搜索。

### social.ts → `/api/social`

- `POST /api/social/send`
- `POST /api/social/contact`
- `POST /api/social/contact/respond`
- `GET /api/social/contacts`
- `GET /api/social/messages`
- `POST /api/social/profile`
- `GET /api/social/profile/:handle`
- `POST /api/social/reply`
- `GET /api/social/threads`
- `GET /api/social/thread/:id`
- `GET /api/social/drain/:nodeId`

用途：社交消息、联系人、档案、线程。

### summary.ts → `/api/summary`

- `GET /api/summary/`

用途：日报汇总。

### task-state.ts → `/api/task-state`

- `POST /api/task-state/`
- `GET /api/task-state/`
- `GET /api/task-state/:id`
- `PATCH /api/task-state/:id`

用途：任务状态存储。

### tasks.ts → `/api/tasks`

- `POST /api/tasks/submit`
- `GET /api/tasks/list`
- `GET /api/tasks/:id`
- `POST /api/tasks/:id/cancel`

用途：异步任务提交、查询、取消。

### teach.ts → `/api/teach`

- `POST /api/teach/request`
- `POST /api/teach/respond`
- `POST /api/teach/knowledge`
- `GET /api/teach/sessions`
- `POST /api/teach/complete`

用途：知识传授与教学会话。

### tenant.ts → `/api/tenants`

- `POST /api/tenants/`
- `GET /api/tenants/`
- `GET /api/tenants/:id`
- `PATCH /api/tenants/:id`

用途：租户管理。

### trace.ts → `/api/chat`

- `GET /api/chat/message/:id/status`
- `GET /api/chat/message/:id/trace`

用途：消息状态与轨迹查询。

### tunnel.ts → `/tunnel`

- `GET /tunnel/`

此外 `server.ts` 注释说明还支持：

- `WS /tunnel/ws`
- `/tunnel/:nodeId/*` 反向代理

### watchdog.ts → `/api/watchdog`

- `POST /api/watchdog/heartbeat`
- `GET /api/watchdog/status`
- `GET /api/watchdog/status/:nodeId`
- `POST /api/watchdog/policy`

用途：心跳、健康、策略。

### workspace.ts → `/api/workspaces`

- `POST /api/workspaces/`
- `GET /api/workspaces/`
- `GET /api/workspaces/:id`
- `PATCH /api/workspaces/:id`

用途：工作区管理。

---

## 说明

1. 路径前缀以 `server.ts` 的 `app.use(...)` 为准。
2. 个别日志输出与真实挂载路径有轻微差异，例如：
   - 日志里写 `/api/report`
   - 实际挂载是 `/api/reports`
3. 若需补充请求体/响应体结构，建议逐个打开对应路由源码继续细化。
