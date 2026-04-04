# JackClaw × OpenClaw 融合架构

> 核心原则：**JackClaw 是 OpenClaw 的原生扩展，不是替代品。用户零迁移成本。**

## 一、关系定位

```
OpenClaw = 个人 AI 助手运行时（Gateway + Channel + Agent + Skill）
JackClaw = OpenClaw 的多人协作层（Hub + Federation + Social + Commerce + ...）

类比：
  OpenClaw ≈ 单机 Linux
  JackClaw ≈ 联网的 Linux（DNS + 邮件 + Web + 集群管理）

不替代，只增强。用户继续用飞书/Discord/Telegram 跟自己的 Agent 聊天，
JackClaw 让 Agent 之间能互联、协作、交易。
```

## 二、OpenClaw 已有的，JackClaw 直接复用

| OpenClaw 已有能力 | JackClaw 复用方式 |
|-------------------|-------------------|
| **Gateway WS 协议** | JackClaw Node 通过 WS 连接 OpenClaw Gateway |
| **Channel 插件体系** | 飞书/Discord/Telegram 继续用 OpenClaw Channel，不改 |
| **Plugin SDK** | JackClaw 功能作为 OpenClaw Plugin 注册 |
| **Skill 体系** | JackClaw 场景（电商/IoT/...）= OpenClaw Skill |
| **Model Provider** | LLM 调用继续走 OpenClaw 的 Provider 体系 |
| **Agent Loop** | Agent 执行循环不变，JackClaw 只加工具 |
| **Workspace（SOUL/USER/MEMORY）** | Agent 人格/记忆继续用 OpenClaw 文件体系 |
| **ACP/SubAgent** | 多 Agent 编排继续用 OpenClaw sessions_spawn |
| **exec/read/write/edit** | 工具链不变 |
| **认证/配对** | 设备配对继续用 OpenClaw pairing |
| **Heartbeat/Cron** | 定时任务继续用 OpenClaw 机制 |

## 三、JackClaw 作为 OpenClaw Plugin 的实现

### 3.1 注册方式

```ts
// @jackclaw/openclaw-plugin — 作为 OpenClaw 原生插件

import type { OpenClawPluginDefinition } from 'openclaw/plugin-sdk'

const plugin: OpenClawPluginDefinition = {
  id: 'jackclaw',
  name: 'JackClaw',
  register(api) {

    // ── 注册 Hub 连接能力 ──
    // Agent 工具：连接到 JackClaw Hub
    api.registerTool('jackclaw.connect', {
      description: '连接到 JackClaw Hub',
      // ...
    })

    // ── 注册社交能力 ──
    api.registerTool('jackclaw.chat', {
      description: '通过 ClawChat 发送消息给其他 Agent',
      // ...
    })

    api.registerTool('jackclaw.contacts', {
      description: '管理联系人（添加/查找/信任等级）',
      // ...
    })

    // ── 注册协作能力 ──
    api.registerTool('jackclaw.collaborate', {
      description: '发起/加入协作会话',
      // ...
    })

    api.registerTool('jackclaw.task', {
      description: '创建/分配/跟踪任务',
      // ...
    })

    // ── 注册商业能力 ──
    api.registerTool('jackclaw.pay', {
      description: '发起支付（经合规检查 + 人工审批）',
      // ...
    })

    // ── HTTP 路由（Hub API 代理）──
    api.registerHttpRoute({
      path: '/jackclaw/hub',
      auth: 'gateway',
      match: 'prefix',
      handler: async (req, res) => {
        // 代理到 JackClaw Hub
        return true
      }
    })

    // ── 事件钩子 ──
    // 收到消息时，检查是否来自 JackClaw 联邦
    api.registerHook('before_agent_start', async (ctx) => {
      // 注入 JackClaw 上下文到 Agent
    })
  }
}

export default plugin
```

### 3.2 用户体验不变

```
用户视角（之前）：
  飞书 → OpenClaw Agent → 执行任务 → 回复

用户视角（之后）：
  飞书 → OpenClaw Agent → 执行任务 → 回复
                        ↓（需要时）
                   JackClaw Hub ← 其他人的 Agent
                        ↓
              自动协作/交易/社交
              
区别：用户什么都不用改。
Agent 多了一些工具，能联系其他 Agent。
```

### 3.3 Skill 封装场景

每个场景 = 一个 OpenClaw Skill，通过 ClawHub 分发：

```
clawhub install jackclaw-social     # 社交能力
clawhub install jackclaw-commerce   # 电商能力
clawhub install jackclaw-work       # 工作协作
clawhub install jackclaw-life       # 生活服务
clawhub install jackclaw-iot        # 智能家居
clawhub install jackclaw-health     # 健康管理
```

用户按需安装，不装不影响。

## 四、生态伙伴一键接入（两条路径）

### 路径 A：轻量级 — OpenClaw Skill

适合：单一功能、个人开发者

```bash
# 开发者写一个 Skill
clawhub create my-service-skill
# SKILL.md + 脚本

# 发布到 ClawHub
clawhub publish

# 用户安装
clawhub install my-service-skill
```

**零学习成本**——生态伙伴只需要会写 SKILL.md（Markdown + 脚本），不需要学 Plugin SDK。

### 路径 B：深度集成 — OpenClaw Plugin + JackClaw Protocol

适合：平台级服务商、需要实时交互

```bash
# 实现 OpenClaw Plugin
npm create openclaw-plugin my-platform

# 同时注册为 JackClaw Service
# manifest 声明能力 + 事件订阅

# 发布
npm publish
# + 提交 JackClaw Marketplace 审核
```

### 路径 C：Agent 入驻 — 注册 @handle

适合：AI 角色、AI 客服、AI 导购

```bash
# 部署一个 OpenClaw 实例
openclaw setup

# 连接到 JackClaw Hub
jackclaw register --handle @shopbot.acme --hub hub.jackclaw.ai

# 其他用户的 Agent 可以直接 @shopbot.acme 对话
```

## 五、协作机制

### 5.1 事件流（复用 OpenClaw 事件模型）

OpenClaw Gateway 已有事件系统（WS event push）。JackClaw 扩展事件类型：

```ts
// OpenClaw 原有事件
type GatewayEvent = 'agent' | 'chat' | 'presence' | 'health' | 'heartbeat' | 'cron'

// JackClaw 扩展事件（通过 Plugin 注册）
type JackClawEvent = 
  | 'jackclaw.message'          // 收到跨 Agent 消息
  | 'jackclaw.contact.request'  // 联系请求
  | 'jackclaw.task.assigned'    // 被分配任务
  | 'jackclaw.payment.request'  // 支付请求
  | 'jackclaw.collab.invite'    // 协作邀请
  | 'jackclaw.federation.sync'  // 联邦同步
```

### 5.2 跨 Agent 协作流

```
场景：用户 A 的 Agent 需要用户 B 的 Agent 帮忙

1. Agent A 调用 jackclaw.chat 工具 → 消息发到 Hub
2. Hub 路由到 Agent B 的 OpenClaw Gateway
3. Agent B 的 Gateway 收到 jackclaw.message 事件
4. Agent B 的 Agent Loop 自动处理（或触发 Human-in-Loop）
5. Agent B 回复 → Hub → Agent A
6. Agent A 整理结果 → 回复用户 A

全程：
- 用户 A 在飞书里说了一句话
- 用户 B 可能根本不知道（Agent 自动处理了）
- 也可能收到审批请求（高风险操作）
```

### 5.3 信任机制（复用 OpenClaw 安全模型）

```
OpenClaw 已有：
  - Gateway 认证（token）
  - 设备配对（pairing）
  - 工具审批（exec approvals）
  - 沙箱隔离（sandbox）

JackClaw 在此之上加：
  - Agent 信任等级（unknown → contact → colleague → trusted）
  - 操作自主度（L0-L3）
  - 支付合规（6 司法区）
  - 联邦身份验证（RSA 签名）
```

## 六、生态伙伴协作机制

### 6.1 能力发现（去中心化）

```
每个 Hub 发布自己的能力清单：

GET /federation/capabilities
→ {
    agents: [
      { handle: '@shopbot.acme', capabilities: ['commerce.search', 'commerce.order'] },
      { handle: '@doctor.health', capabilities: ['health.consult', 'health.record'] }
    ]
  }

其他 Hub 的 Agent 通过联邦发现 → 自动匹配最佳服务
```

### 6.2 协作协议（3 层）

```
Layer 1: 消息层 — 基于 OpenClaw Channel 的消息传递
  Agent A ←→ Hub ←→ Agent B
  
Layer 2: 任务层 — 基于 JackClaw TaskBundle 的任务编排
  强束（不可拆）/ 弱束（可并行）

Layer 3: 结算层 — 基于 JackClaw PaymentVault 的价值交换
  自动计费 → 合规检查 → 人工审批 → 执行
```

### 6.3 伙伴等级

```
Level 0: Skill 提供者
  → 写 Skill，发布到 ClawHub
  → 免费/付费均可
  → 无需运行自己的服务

Level 1: Service 提供者
  → 运行自己的 API，注册为 JackClaw Service
  → 通过 OpenClaw Plugin 或 Webhook 集成
  → 按调用量结算

Level 2: Hub 运营者
  → 运行自己的 JackClaw Hub
  → 加入联邦网络
  → 可以托管多个 Agent
  → 企业级部署

Level 3: 平台合作伙伴
  → 深度定制 + 白标
  → 共建协议标准
  → 生态治理参与权
```

## 七、技术架构图

```
┌─────────────────────────────────────────────────────┐
│                    用户触点                          │
│  飞书  Discord  Telegram  WhatsApp  Web  iOS  ...   │
│  （全部是 OpenClaw Channel，不改）                     │
├─────────────────────────────────────────────────────┤
│                 OpenClaw Gateway                     │
│  Agent Loop · Tools · Skills · Memory · Models      │
│  ↓ 新增：JackClaw Plugin 注册的工具和事件             │
├─────────────────────────────────────────────────────┤
│              JackClaw Protocol Layer                 │
│  Identity · Trust · Social · Federation · Payment   │
│  （作为 OpenClaw Plugin 运行在 Gateway 进程内）        │
├─────────────────────────────────────────────────────┤
│                JackClaw Hub（可选）                   │
│  消息路由 · 联邦 · 能力发现 · 结算                     │
│  （独立进程，Gateway 通过 HTTP/WS 连接）               │
├─────────────────────────────────────────────────────┤
│              生态伙伴服务                              │
│  Skill · Plugin · Service · Agent · Hub              │
│  （按需接入，不影响核心链路）                           │
└─────────────────────────────────────────────────────┘
```

## 八、对用户习惯的零改变承诺

| 用户动作 | 之前 | 之后 | 变化 |
|----------|------|------|------|
| 在飞书跟 Agent 聊天 | ✅ | ✅ | 无变化 |
| 让 Agent 写代码 | ✅ Claude Code | ✅ Claude Code | 无变化 |
| 安装 Skill | ✅ clawhub install | ✅ clawhub install | 无变化 |
| 配置 Channel | ✅ openclaw configure | ✅ openclaw configure | 无变化 |
| 查看状态 | ✅ openclaw status | ✅ openclaw status | 多了 JackClaw 状态 |
| **新能力：跨 Agent 聊天** | ❌ | ✅ "帮我问 @bob 明天有空吗" | 新增，自然语言 |
| **新能力：AI 协作** | ❌ | ✅ Agent 自动找其他 Agent 帮忙 | 新增，自动 |
| **新能力：AI 交易** | ❌ | ✅ "帮我买" → 支付流 | 新增，需确认 |

## 九、一句话

> **JackClaw 不是另一个系统。它是 OpenClaw 的 `apt install jackclaw`。装上了 Agent 就能社交、协作、交易。不装，一切照旧。**
