# JackClaw 生态架构 — AI 原生操作系统

> 目标：任何开发者/企业/AI 都能一键接入 JackClaw，像安装 App 一样简单，像 TCP/IP 一样可靠。

## 一、定位

```
传统互联网：OS → App → 用户
AI 原生：    JackClaw → Plugin → Agent → 人

JackClaw 不是一个 App，是 AI 世界的 OS。
Plugin 不是功能，是 AI 的器官。
消息不是聊天，是血液。
```

## 二、生态三层架构

```
┌──────────────────────────────────────────────────────────┐
│                    开放生态层 (Marketplace)                │
│  第三方 Plugin · 服务商 · AI 角色 · 数据源 · 硬件厂商      │
├──────────────────────────────────────────────────────────┤
│                    协作协议层 (Protocol)                   │
│  身份 · 信任 · 消息 · 事件 · 能力发现 · 结算               │
├──────────────────────────────────────────────────────────┤
│                    运行时层 (Runtime)                      │
│  EventBus · PluginManager · Sandbox · 权限 · 审计          │
└──────────────────────────────────────────────────────────┘
```

## 三、一键接入机制

### 3.1 生态伙伴接入方式

```
方式 A：Plugin 模式（轻量，纯逻辑）
  → npm install @jackclaw/plugin-xxx
  → 实现 JackClawPlugin 接口
  → Hub 自动加载，零配置

方式 B：Service 模式（重量，独立服务）
  → 注册为 JackClaw Service（HTTP/gRPC endpoint）
  → Hub 作为代理，消息路由到外部服务
  → 适合：支付网关、地图服务、IoT 平台

方式 C：Agent 模式（AI 原生）
  → 注册为 JackClaw Agent（有自己的 @handle）
  → 直接参与 Chat，像人一样协作
  → 适合：AI 客服、AI 导购、AI 教练
```

### 3.2 Plugin 接口（核心）

```ts
interface JackClawPlugin {
  // ─── 身份 ───
  manifest: PluginManifest

  // ─── 生命周期 ───
  onLoad(ctx: PluginContext): Promise<void>
  onUnload(): Promise<void>

  // ─── 事件响应 ───
  onEvent?(event: JackClawEvent): Promise<EventResult | void>

  // ─── 命令处理 ───
  onCommand?(cmd: string, args: any, ctx: CommandContext): Promise<any>

  // ─── 卡片交互回调 ───
  onCardAction?(action: CardAction, ctx: CardContext): Promise<CardUpdate | void>

  // ─── 定时任务 ───
  onSchedule?(schedule: ScheduleContext): Promise<void>

  // ─── 健康检查 ───
  health?(): Promise<HealthStatus>
}

interface PluginManifest {
  name: string                    // 唯一标识，如 "commerce.shopify"
  version: string                 // semver
  displayName: string             // 显示名
  description: string
  author: string
  license: string

  // ─── 能力声明 ───
  events: string[]                // 订阅哪些事件
  commands: CommandDef[]          // 注册哪些命令
  messageTypes: string[]          // 能处理哪些消息类型
  cardTypes: string[]             // 提供哪些卡片类型

  // ─── 权限需求 ───
  permissions: PluginPermission[]
  
  // ─── 依赖 ───
  dependencies: string[]          // 依赖哪些其他 Plugin
  
  // ─── 场景标签 ───
  scenes: SceneTag[]              // 属于哪些场景
  
  // ─── 定价 ───
  pricing?: PluginPricing
}

type SceneTag = 
  | 'social' | 'commerce' | 'work' | 'life' 
  | 'entertainment' | 'health' | 'iot' | 'finance'
  | 'education' | 'travel' | 'food' | 'creative'
  | string                        // 自定义场景

type PluginPermission =
  | 'message.read'               // 读消息
  | 'message.send'               // 发消息
  | 'message.intercept'          // 拦截/修改消息（危险）
  | 'user.profile'               // 读用户资料
  | 'user.contacts'              // 读联系人
  | 'memory.read'                // 读 Agent 记忆
  | 'memory.write'               // 写 Agent 记忆
  | 'payment.initiate'           // 发起支付
  | 'payment.receive'            // 接收支付
  | 'iot.control'                // 控制 IoT 设备
  | 'calendar.read'              // 读日历
  | 'calendar.write'             // 写日历
  | 'llm.call'                   // 调用 LLM
  | 'file.read'                  // 读文件
  | 'file.write'                 // 写文件
  | 'network.outbound'           // 外网请求
  | 'schedule.cron'              // 定时任务
  | string                       // 自定义权限
```

### 3.3 Plugin 上下文（Plugin 能拿到什么）

```ts
interface PluginContext {
  // 当前 Hub 信息
  hub: { url: string; version: string }
  
  // 事件总线（发布/订阅）
  bus: EventBus
  
  // 消息发送
  send(to: string, msg: Partial<ChatMessage>): Promise<void>
  
  // 卡片推送
  pushCard(to: string, card: CardMessage): Promise<void>
  
  // 调用 LLM
  llm: LLMGateway
  
  // 存储（Plugin 隔离的 KV）
  store: PluginStore
  
  // 日志
  log: Logger
  
  // 调用其他 Plugin 的能力
  call(pluginName: string, method: string, args: any): Promise<any>
  
  // 注册 Webhook 回调
  registerWebhook(path: string, handler: WebhookHandler): void
  
  // 获取用户授权
  requestPermission(userId: string, perm: PluginPermission): Promise<boolean>
}
```

## 四、事件系统（神经系统）

```ts
// ─── 内置事件类型 ───

type JackClawEventType =
  // 消息
  | 'message.received'           // 收到消息
  | 'message.sent'               // 消息已发送
  | 'message.delivered'          // 消息已送达
  | 'message.read'               // 消息已读
  | 'message.recalled'           // 消息撤回

  // 用户
  | 'user.online'                // 上线
  | 'user.offline'               // 离线
  | 'user.typing'                // 正在输入
  | 'user.registered'            // 新用户注册

  // 社交
  | 'contact.request'            // 联系请求
  | 'contact.accepted'           // 联系确认
  | 'group.created'              // 群创建
  | 'group.member.joined'        // 入群
  | 'group.member.left'          // 退群

  // 任务
  | 'task.created'               // 任务创建
  | 'task.assigned'              // 任务分配
  | 'task.completed'             // 任务完成
  | 'task.failed'                // 任务失败

  // 支付
  | 'payment.requested'          // 支付请求
  | 'payment.approved'           // 支付批准
  | 'payment.completed'          // 支付完成
  | 'payment.failed'             // 支付失败

  // 卡片交互
  | 'card.action'                // 卡片按钮点击
  | 'card.submitted'             // 卡片表单提交

  // IoT
  | 'iot.device.online'          // 设备上线
  | 'iot.device.offline'         // 设备离线
  | 'iot.device.alert'           // 设备告警
  | 'iot.data.received'          // 设备数据上报

  // 系统
  | 'plugin.loaded'              // Plugin 加载
  | 'plugin.unloaded'            // Plugin 卸载
  | 'hub.federation.connected'   // 联邦连接
  | 'schedule.triggered'         // 定时任务触发

  // 自定义
  | `x-${string}`                // 第三方自定义事件

interface JackClawEvent {
  type: JackClawEventType
  source: string                 // 来源 Plugin 或系统
  data: any                      // 事件数据
  ts: number
  // 事件链路追踪
  traceId: string
  parentEventId?: string         // 由哪个事件触发的
}

// ─── 事件流水线（可拦截/修改/终止） ───

interface EventResult {
  // Plugin 可以：
  handled?: boolean              // 标记已处理（不影响后续）
  modified?: any                 // 修改事件数据（传给下一个 Plugin）
  stop?: boolean                 // 终止事件传播（需要 message.intercept 权限）
  emit?: JackClawEvent[]         // 触发新事件
}
```

## 五、交互式卡片协议（UI 层）

```ts
// 统一卡片结构 — 所有场景的 UI 交互都走这个

interface CardMessage {
  cardId: string
  type: CardType
  title: string
  body: CardElement[]            // 卡片内容元素
  actions?: CardAction[]         // 可操作按钮
  footer?: string
  theme?: 'default' | 'success' | 'warning' | 'error'
  expiresAt?: number             // 过期后不可操作
  pluginSource: string           // 来自哪个 Plugin
}

type CardType =
  | 'info'                       // 纯信息展示
  | 'form'                       // 表单（收集输入）
  | 'approval'                   // 审批（同意/拒绝）
  | 'product'                    // 商品卡片
  | 'order'                      // 订单卡片
  | 'payment'                    // 支付卡片
  | 'calendar'                   // 日程卡片
  | 'task'                       // 任务卡片
  | 'iot-control'                // 设备控制面板
  | 'health-report'              // 健康报告
  | 'poll'                       // 投票
  | 'location'                   // 位置分享
  | `x-${string}`                // 自定义

type CardElement =
  | { type: 'text'; content: string }
  | { type: 'image'; url: string; alt?: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'progress'; label: string; value: number; max: number }
  | { type: 'input'; name: string; placeholder?: string; required?: boolean }
  | { type: 'select'; name: string; options: { label: string; value: string }[] }
  | { type: 'divider' }
  | { type: 'metric'; label: string; value: string; trend?: 'up' | 'down' | 'flat' }

interface CardAction {
  actionId: string
  label: string
  style?: 'primary' | 'danger' | 'default'
  confirm?: string               // 二次确认文案
  payload?: Record<string, any>  // 回传数据
}
```

## 六、协作协议（生态伙伴如何协作）

### 6.1 能力发现

```ts
// 每个 Plugin/Agent/Service 注册时声明能力
// Hub 维护全局能力注册表

interface CapabilityRegistry {
  // "我需要打车" → 找到 travel.didi Plugin
  discover(intent: string): CapabilityMatch[]
  
  // "谁能处理 image/png" → 找到 creative.dalle Plugin
  findByMimeType(mime: string): CapabilityMatch[]
  
  // "谁订阅了 payment.completed" → 找到 finance.ledger Plugin
  findByEvent(event: string): string[]
}

interface CapabilityMatch {
  pluginName: string
  confidence: number             // 0-1 匹配度
  pricing?: PluginPricing        // 使用成本
  trustLevel: TrustLevel         // 信任等级
}
```

### 6.2 Plugin 间协作流

```
场景：用户说 "帮我订明天飞上海的机票"

1. IntentEngine 解析意图 → intent: "book.flight"
2. CapabilityRegistry 发现 → travel.ctrip Plugin
3. travel.ctrip 查询航班 → 推送 CardMessage（航班列表）
4. 用户选择 → CardAction 回调
5. travel.ctrip 创建订单 → 触发 payment.requested 事件
6. PaymentVault 处理支付 → 合规检查 → 人工确认
7. 支付完成 → 触发 payment.completed 事件
8. travel.ctrip 确认出票 → 推送订单卡片
9. calendar.plugin 收到事件 → 自动创建日程
10. life.plugin 收到事件 → 提前一天推送出行提醒

整个流程：用户只说了一句话，5个 Plugin 协作完成。
```

### 6.3 结算机制

```ts
// Plugin 可以声明定价，Hub 自动结算

interface PluginPricing {
  model: 'free' | 'per-call' | 'subscription' | 'revenue-share'
  
  // per-call
  pricePerCall?: number          // USD
  
  // subscription
  monthlyPrice?: number          // USD
  
  // revenue-share
  revenueSharePercent?: number   // 如电商 Plugin 抽成
  
  // 免费额度
  freeQuota?: {
    calls?: number               // 每月免费调用次数
    period: 'daily' | 'monthly'
  }
}

// Hub 内置微支付结算层
interface SettlementEngine {
  // Plugin A 调用 Plugin B 的能力 → 自动计费
  recordUsage(caller: string, provider: string, amount: number): void
  
  // 月底结算
  settle(period: string): SettlementReport
}
```

## 七、安全与信任

### 7.1 Plugin 沙箱

```ts
interface PluginSandbox {
  // 文件系统：只能访问自己的 store，不能读其他 Plugin
  fs: ScopedFS
  
  // 网络：需要 network.outbound 权限
  // 默认只能访问 Hub API，不能外联
  network: ScopedNetwork
  
  // 内存：有上限，超出自动 OOM kill
  memoryLimit: number            // bytes
  
  // CPU：有时间限制，超时自动终止
  cpuTimeLimit: number           // ms per event handler
  
  // 权限：运行时动态检查
  permissions: Set<PluginPermission>
}
```

### 7.2 信任传递

```
用户信任 Hub → Hub 审核 Plugin → Plugin 声明权限 → 用户授权

信任链：
  L0: Plugin 上架需代码审计
  L1: 用户安装时明确授权每项权限
  L2: 运行时权限动态校验
  L3: 敏感操作触发 Human-in-Loop
  L4: 审计日志不可篡改
```

### 7.3 隐私控制

```ts
interface PrivacyManager {
  // 用户控制哪些数据可以给哪些 Plugin
  setPolicy(userId: string, policy: PrivacyPolicy): void
  
  // Plugin 请求数据前检查授权
  checkAccess(pluginName: string, dataType: string, userId: string): boolean
  
  // 数据导出/删除（GDPR 合规）
  exportUserData(userId: string): Promise<UserDataExport>
  deleteUserData(userId: string): Promise<void>
}

interface PrivacyPolicy {
  // 精细到每个 Plugin × 每种数据类型
  rules: Array<{
    plugin: string | '*'         // 哪个 Plugin（* = 所有）
    dataType: string             // 消息/位置/健康/消费/...
    access: 'allow' | 'deny' | 'ask'  // ask = 每次询问
    retention?: number           // 保留天数（0 = 不保留）
  }>
}
```

## 八、生态伙伴一键接入流程

```
Step 1: 注册
  → jackclaw.ai/developer 注册开发者账号
  → 获取 API Key + Plugin SDK

Step 2: 开发
  → npx create-jackclaw-plugin my-plugin
  → 实现接口，本地调试
  → jackclaw dev（本地 Hub 热加载测试）

Step 3: 发布
  → jackclaw publish（提交审核）
  → 代码扫描 + 权限审查 + 沙箱测试
  → 审核通过 → 上架 Plugin Marketplace

Step 4: 用户安装
  → 在 ClawChat 里 "安装 xxx Plugin"
  → 授权弹窗 → 确认权限
  → 即刻可用

Step 5: 结算
  → 月底自动结算
  → 开发者后台查看收入/用量
```

### CLI 工具链

```bash
# 脚手架
npx create-jackclaw-plugin my-plugin --scene commerce

# 本地开发
jackclaw dev                    # 热加载到本地 Hub

# 测试
jackclaw test                   # 沙箱内运行测试

# 发布
jackclaw publish                # 提交审核
jackclaw publish --beta         # 发布到测试频道

# 管理
jackclaw plugins list           # 查看已安装 Plugin
jackclaw plugins install xxx    # 安装
jackclaw plugins remove xxx     # 卸载
jackclaw plugins update         # 更新所有
```

## 九、与现有模块的映射关系

```
现有模块              →  生态架构中的角色
─────────────────────────────────────────────
Hub                   →  Runtime（消息管道 + Plugin 运行时）
Protocol/types        →  协议层（扩展 MessageType + EventType）
Protocol/social       →  内置 SocialPlugin
Protocol/payment      →  内置 PaymentPlugin
Protocol/federation   →  Hub 联邦（Plugin 跨 Hub 可用）
Protocol/identity     →  身份层（Plugin 共用）
Protocol/human-loop   →  安全层（Plugin 触发审批）
Protocol/concierge    →  内置 LifePlugin 的子模块
Memory                →  Plugin 可调用的记忆 API
LLM Gateway           →  Plugin 可调用的 LLM API
Watchdog              →  Plugin 监控 + 健康检查
Dashboard             →  Plugin 管理 UI + 开发者后台
PWA                   →  用户端（展示卡片 + Plugin UI）
```

## 十、竞争壁垒

```
为什么生态伙伴选 JackClaw 而不是自己做：

1. 统一身份 — 不用每个 App 单独注册登录
2. 统一消息 — 不用自建通信层
3. 统一支付 — 不用自己做合规
4. 统一信任 — 信任关系跨 Plugin 复用
5. 跨场景联动 — 一个 Plugin 的输出是另一个的输入
6. AI 原生 — Agent 可以代表用户自动调用 Plugin
7. 联邦制 — 不锁定在单一平台
8. 开发者友好 — npm 生态 + 热加载 + 完善 SDK
```

## 十一、路线图

```
Phase 0 — 地基（现在）
  ✦ EventBus + PluginManager + CardMessage
  ✦ 重构 Hub routes → 内置 Plugin

Phase 1 — 内部验证（2周）
  ✦ 3个内置 Plugin：Social + Work + Life
  ✦ 渠道桥接：飞书 ↔ ClawChat
  ✦ Plugin 热加载 + 权限系统

Phase 2 — 开发者预览（1个月）
  ✦ create-jackclaw-plugin 脚手架
  ✦ Plugin SDK + 文档
  ✦ 本地开发调试工具链

Phase 3 — 生态启动（Q3）
  ✦ Plugin Marketplace
  ✦ 结算系统
  ✦ 首批 10 个第三方 Plugin

Phase 4 — 规模化（Q4）
  ✦ 联邦 Plugin 发现（跨 Hub）
  ✦ 企业版 Plugin 私有部署
  ✦ AI Agent 自主安装/组合 Plugin
```

## 核心一句话

> **JackClaw = AI 世界的 Android。Hub 是内核，Plugin 是 App，Protocol 是 AOSP，Marketplace 是 Play Store。生态伙伴不是"接入"JackClaw——他们是在 JackClaw 上"建 App"。**
