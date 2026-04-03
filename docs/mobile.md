# JackClaw 移动端适配方案

> 版本：v1.0 · 2026-04-03

---

## 一、OpenClaw 移动端现状分析

### 1.1 OpenClaw companion app 接入机制

OpenClaw 提供 iOS 和 Android 两个 Node 端 app，核心机制：

| 组件 | 说明 |
|------|------|
| **Gateway** | 运行在 macOS/Linux，WebSocket 服务（默认端口 18789） |
| **Node App** | iOS/Android 通过 WS 连接 Gateway，role = `node` |
| **发现方式** | Bonjour/mDNS（局域网）、Tailscale unicast DNS-SD（跨网）、手动 host:port |
| **配对** | device pairing 机制，CLI `openclaw devices approve <requestId>` |
| **推送通知** | iOS：APNs relay（官方）或直连 APNs（本地构建）；Android：FCM |
| **Node 能力** | canvas、camera、device.status、notifications、calendar、sms、contacts |

### 1.2 JackClaw 架构差异

JackClaw Hub（`:3100`）是独立的 CEO 汇报中枢，**不依赖 OpenClaw Gateway**：

```
Agent Nodes  →  POST /api/report  →  JackClaw Hub  ←→  CEO (Dashboard/Mobile)
                                      JWT Auth
                                      RSA-4096 加密
```

Hub 提供的 API：
- `POST /api/register` — Node 注册
- `POST /api/report` — Agent 汇报（JWT + RSA 加密）
- `GET  /api/nodes` — 节点列表（CEO only）
- `GET  /api/summary?date=YYYY-MM-DD` — 日汇报摘要（CEO only）

---

## 二、CEO 移动端需求

| 需求 | 优先级 |
|------|--------|
| 随时查看团队汇报摘要 | P0 |
| 收到重要汇报的推送通知 | P0 |
| 语音/文字向团队 Agent 委派任务 | P1 |
| 审批 Agent 提交的决策 | P1 |

---

## 三、方案对比

### 方案 A：直接复用 OpenClaw companion app

**思路**：将 JackClaw Hub 注册为 OpenClaw Gateway，利用 iOS/Android app 已有的 WebSocket + 推送通知基础设施。

| 维度 | 评估 |
|------|------|
| 开发成本 | **1-2 周**（适配协议层，无需写 UI） |
| 用户体验 | ⭐⭐⭐（通用 UI，无 CEO 专属设计） |
| 维护成本 | 低（跟随 OpenClaw 版本） |
| 局限性 | iOS 未公开发布；APNs relay 需官方构建；UI 完全是通用 node 界面，无汇报/审批专属视图 |
| **推荐指数** | ⭐⭐ |

**适合场景**：原型验证、内部测试阶段。

---

### 方案 B：JackClaw 专属 React Native App

**思路**：基于 React Native 开发原生 iOS/Android app，深度定制 CEO 工作流。

| 维度 | 评估 |
|------|------|
| 开发成本 | **8-12 周**（含 iOS/Android 双端、APNs + FCM） |
| 用户体验 | ⭐⭐⭐⭐⭐（原生体验，动画流畅，离线支持） |
| 维护成本 | 高（双端兼容、App Store 审核、版本管理） |
| 技术栈 | React Native + Expo / Bare，TypeScript |
| **推荐指数** | ⭐⭐⭐ |

**适合场景**：产品化后、需要对外分发时。

---

### 方案 C：PWA（渐进式 Web App）⭐ 推荐

**思路**：在现有 dashboard/index.html 基础上升级为 PWA，支持安装到手机桌面 + 推送通知。

| 维度 | 评估 |
|------|------|
| 开发成本 | **1-2 周**（manifest + service worker + 移动端 UI 优化） |
| 用户体验 | ⭐⭐⭐⭐（安装后全屏，有推送，接近原生） |
| 维护成本 | 极低（Web 技术栈，一套代码） |
| 推送通知 | Web Push API（标准；Android Chrome 完整支持；iOS Safari 16.4+ 支持） |
| 无需审核 | 直接通过 URL 分发，无 App Store |
| **推荐指数** | ⭐⭐⭐⭐⭐ |

**适合场景**：MVP 阶段首选，可快速迭代，未来平滑升级为方案 B。

---

## 四、推荐方案 C - 详细设计

### 4.1 页面结构

```
JackClaw PWA
├── /              首页（Dashboard）
│   ├── 节点在线状态总览
│   ├── 今日汇报摘要卡片
│   └── 快捷操作按钮（委派任务 / 审批）
├── /reports       汇报详情
│   ├── 日期选择器
│   ├── 按角色分组汇报列表
│   └── 单条汇报展开（全文 + 附件）
├── /tasks         任务委派
│   ├── 新建任务（文字/语音输入）
│   ├── 选择目标 Agent
│   └── 已委派任务追踪
├── /approvals     审批中心
│   ├── 待审批列表（角标提示数量）
│   ├── 审批详情（背景/建议/影响）
│   └── 一键批准 / 驳回 + 备注
└── /settings      设置
    ├── Hub URL 配置
    ├── JWT Token 管理
    ├── 推送通知开关
    └── 离线缓存状态
```

### 4.2 关键交互流程

#### 流程 1：接收重要汇报推送

```
Hub 检测到高优先级汇报
  → Hub 调用 Web Push API（VAPID）
  → Service Worker 拦截 push 事件
  → 显示系统通知：「[Marketing Agent] 日报：转化率下降 15%，需关注」
  → 用户点击通知
  → PWA 打开 /reports?id=xxx 直达详情
```

#### 流程 2：语音委派任务

```
首页点击「🎙️ 委派任务」
  → 调用 Web Speech API（SpeechRecognition）
  → 实时显示语音转文字
  → 确认后提交到 POST /api/tasks
  → Hub 下发给目标 Agent
  → 返回任务 ID + 预计完成时间
```

#### 流程 3：审批 Agent 决策

```
收到推送：「[Finance Agent] 申请审批：Q2 预算调整 +20%」
  → 进入 /approvals
  → 查看决策背景、数据支撑、风险评估
  → 批准 → PUT /api/approvals/:id { status: 'approved', note: '' }
  → Hub 将结果转发给对应 Agent
  → Agent 继续执行后续工作流
```

### 4.3 与 Hub API 的对接方式

#### 现有 API（已实现）

```typescript
GET  /api/nodes           // 节点状态列表
GET  /api/summary?date=   // 日汇报摘要
POST /api/register        // 节点注册
POST /api/report          // Agent 上报（JWT 鉴权）
```

#### 需要新增的 API

```typescript
// 任务委派
POST   /api/tasks
  body: { targetNodeId, title, description, priority, dueAt }
  auth: CEO JWT

GET    /api/tasks?status=pending&nodeId=xxx
  auth: CEO JWT

// 审批工作流
GET    /api/approvals?status=pending
  auth: CEO JWT

PUT    /api/approvals/:id
  body: { status: 'approved' | 'rejected', note?: string }
  auth: CEO JWT

// Web Push 订阅
POST   /api/push/subscribe
  body: { subscription: PushSubscription, threshold: 'all' | 'important' }
  auth: CEO JWT

DELETE /api/push/subscribe
  auth: CEO JWT
```

#### 认证方式

```javascript
// PWA 中统一封装
async function apiCall(path, options = {}) {
  const token = localStorage.getItem('jackclaw_hub_token')
  return fetch(HUB_URL + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    },
  })
}
```

### 4.4 推送通知实现

#### Web Push (VAPID) 方案

```
┌─────────────────────────────────────────────────────────┐
│                  推送通知完整流程                         │
│                                                         │
│  1. PWA 前端                                             │
│     ServiceWorkerRegistration.pushManager.subscribe()   │
│     获得 PushSubscription { endpoint, keys }            │
│     POST /api/push/subscribe 保存到 Hub                  │
│                                                         │
│  2. Hub 后端                                             │
│     收到重要汇报时（优先级判断逻辑）                       │
│     用 web-push 库 + VAPID keys 发送推送                  │
│     web-push.sendNotification(subscription, payload)    │
│                                                         │
│  3. Service Worker                                       │
│     监听 push 事件                                       │
│     self.registration.showNotification(title, options)  │
│     监听 notificationclick → clients.openWindow(url)    │
│                                                         │
│  平台支持：                                               │
│     Android Chrome：完整支持                              │
│     iOS Safari 16.4+：支持（需添加到主屏幕）              │
│     iOS 旧版：不支持（降级为 badge + 轮询）               │
└─────────────────────────────────────────────────────────┘
```

#### Hub 端实现要点

```typescript
// packages/hub/src/push.ts
import webpush from 'web-push'

webpush.setVapidDetails(
  'mailto:ceo@jackclaw.ai',
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!,
)

export async function notifyCEO(report: ReportEntry) {
  // 优先级判断：包含关键词或 priority 字段
  if (!isImportant(report)) return

  const subscriptions = loadSubscriptions()
  const payload = JSON.stringify({
    title: `[${report.nodeName}] 新汇报`,
    body: report.summary.slice(0, 120),
    url: `/reports?id=${report.id}`,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
  })

  await Promise.allSettled(
    subscriptions.map(sub => webpush.sendNotification(sub, payload))
  )
}
```

---

## 五、PWA 移动端 UI 规范

### 5.1 移动端布局原则

- 底部导航栏（Tab Bar）：首页 / 汇报 / 任务 / 审批 / 设置
- 卡片式设计，单手可操作
- 字号：正文 16px，标题 20px，辅助信息 13px
- 触摸目标最小 44×44px

### 5.2 配色（与 Dashboard 一致）

```css
--bg:      #0d0d0f   /* 背景 */
--surface: #16181c   /* 卡片 */
--accent:  #6366f1   /* 主色（靛蓝） */
--green:   #22c55e   /* 在线/成功 */
--yellow:  #eab308   /* 警告/待审批 */
--red:     #ef4444   /* 离线/驳回 */
```

### 5.3 安装引导

```javascript
// 监听 beforeinstallprompt 事件
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  // 在合适时机显示「添加到主屏幕」按钮
  showInstallBanner(e)
})
```

---

## 六、技术路线图

```
Week 1
  ├── 创建 packages/pwa/（manifest + service worker）
  ├── Dashboard 升级支持 PWA 安装
  └── 基础推送通知测试（Android）

Week 2
  ├── Hub 新增 /api/tasks + /api/approvals API
  ├── PWA 新增任务委派 + 审批页面
  └── Web Push VAPID 集成

Week 3-4（可选）
  ├── 语音委派（Web Speech API）
  ├── iOS Safari 推送适配（16.4+）
  └── 离线模式优化（IndexedDB 缓存汇报）

未来（方案 B 升级路径）
  └── 将 PWA 逻辑迁移到 React Native + Expo
      复用 Hub API，保持功能一致
```

---

## 七、风险与建议

| 风险 | 缓解措施 |
|------|---------|
| iOS 推送支持率低（旧版本） | 降级方案：角标 + 轮询刷新 |
| JWT Token 泄露 | HTTPS only；token 过期设 7 天；支持远程吊销 |
| Hub 单点故障 | 后续加 SQLite 持久化 + pm2 守护进程 |
| 审批操作误触 | 二次确认弹窗 + 撤销窗口（5s） |

---

*生成时间：2026-04-03 · JackClaw Mobile Agent*
