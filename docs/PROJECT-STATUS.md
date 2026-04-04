# JackClaw 项目总览

> v0.2.0 | 15 packages | 223 files | 37,054 行 TypeScript | MIT

## 一、架构总览

```
┌───────────────────────────────────────────────────┐
│                  用户触点                          │
│  飞书 · Discord · Telegram · WhatsApp · Web/PWA   │
├───────────────────────────────────────────────────┤
│              OpenClaw Gateway（不改）               │
│  Agent Loop · Tools · Skills · Memory · Models    │
│          ↓ JackClaw 作为 OpenClaw Plugin ↓         │
├───────────────────────────────────────────────────┤
│              JackClaw Protocol                    │
│  身份 · 信任 · 加密 · 社交 · 联邦 · 支付 · 任务束   │
├───────────────────────────────────────────────────┤
│               JackClaw Hub                        │
│  消息路由 · WS实时 · 离线队列 · 联邦 · Dashboard   │
├───────────────────────────────────────────────────┤
│             JackClaw Node                         │
│  本地 Agent · 任务执行 · LLM Gateway · Watchdog    │
└───────────────────────────────────────────────────┘
```

## 二、15 个包 — 现状

| 包 | 代码量 | 状态 | 说明 |
|---|--------|------|------|
| **protocol** | 1,736 行 | ✅ 完成 | 消息/加密/身份/信任/社交/联邦/支付/任务束/回执/日程 |
| **hub** | 10,451 行 | ✅ 运行中 | 28 个 API 路由 + WS + 离线队列 + 群聊 + 联邦 |
| **node** | 9,814 行 | ✅ 运行中 | Agent 执行 + 任务链 + 渠道桥接（飞书/Discord/TG/WA/微信） |
| **cli** | 5,319 行 | ✅ 可用 | jackclaw 命令行工具，完整子命令 |
| **llm-gateway** | 2,259 行 | ✅ 可用 | 多模型路由（OpenAI/Anthropic/本地） |
| **memory** | 1,172 行 | ✅ 可用 | 4 分类记忆 + L1 缓存 + 语义搜索 + 协作/教学 |
| **openclaw-plugin** | 1,486 行 | ✅ 可用 | OpenClaw 原生插件封装 |
| **payment-vault** | 411 行 | ✅ 类型完成 | 6 司法区合规引擎 |
| **harness** | 695 行 | ✅ 可用 | Agent 测试/调试框架 |
| **jackclaw-sdk** | 564 行 | ✅ 可用 | 第三方开发 SDK |
| **watchdog** | 859 行 | ✅ 可用 | 安全监控 + 异常检测 |
| **dashboard** | 505 行 | ✅ 基础 | Web 管理面板 |
| **create-jackclaw** | 439 行 | ✅ 可用 | `npx create-jackclaw` 脚手架 |
| **tunnel** | 415 行 | ✅ 可用 | Cloudflare 隧道管理 |
| **pwa** | 静态 | 🟡 框架 | ClawChat PWA 客户端 |

## 三、核心优势

### 1. 协议层完整度极高

```
✅ 端到端加密（RSA-4096 + AES-256-GCM）
✅ 数字签名（每条消息签名验证）
✅ 联邦协议（跨 Hub 握手/路由/发现）
✅ 身份系统（@handle.org.jackclaw 三级域名）
✅ 信任等级（blocked → unknown → contact → colleague → trusted）
✅ 任务束（强束/弱束 + 拓扑排序 + 循环检测）
✅ Human-in-Loop（L0-L3 自主度 + 高风险拦截）
✅ 支付合规（CN/EU/US/HK/SG/GLOBAL 6 司法区）
✅ 消息回执（sending → sent → delivered → read）
✅ 社交协议（名片/联系请求/线程/附件）
✅ 日程协商（自然语言时间解析 + 中文支持）
```

**这是整个项目最大的护城河 — 协议设计严谨，覆盖 AI Agent 交互的完整生命周期。**

### 2. 与 OpenClaw 100% 兼容

```
✅ 作为 OpenClaw Plugin 运行（不是独立系统）
✅ 复用 OpenClaw 渠道（飞书/Discord/TG/WA）
✅ 复用 OpenClaw Agent Loop + Skill + Memory
✅ 复用 OpenClaw 安全模型（认证/配对/审批）
✅ 用户零迁移成本
```

### 3. AI 原生设计

```
✅ Agent 之间直接通信（不经过人类中转）
✅ 信任是一等公民（不是后加的 ACL）
✅ 任务束理论（来自 Messy Jobs 研究）
✅ Human-in-Loop 不是补丁，是核心协议
✅ 联邦制（去中心化，不锁定单一平台）
```

### 4. 全栈一体

```
✅ 协议层 → Hub → Node → CLI → SDK → Dashboard → PWA
✅ 从加密到 UI，一个仓库全覆盖
✅ Monorepo 结构，开发效率高
```

## 四、当前问题

| 问题 | 严重度 | 说明 |
|------|--------|------|
| SQLite 编译失败 | 🔴 | better-sqlite3 在 Node 25 上 binding 找不到，用 JSONL fallback |
| 消息类型太窄 | 🔴 | 只有 7 种，无法表达卡片/交易/IoT |
| 无事件总线 | 🔴 | 功能硬编码在 Hub routes，无法插件化 |
| 无 Plugin 系统 | 🔴 | 28 个 route 文件耦合在 Hub 里 |
| 端到端联调未完成 | 🟡 | Hub + Node 可单独跑，串联有 gap |
| 测试覆盖不足 | 🟡 | 有 E2E 测试框架，但覆盖率低 |
| PWA 只有框架 | 🟡 | 需要完整 UI |

## 五、开发路线图

### Phase 0 — 地基修复（本周 4/4 - 4/10）

| 任务 | 优先级 | 预计工时 | 产出 |
|------|--------|----------|------|
| 修 SQLite（换 libsql 或重编译） | P0 | 2h | 持久化消息存储 |
| EventBus 核心实现 | P0 | 4h | ~100 行，所有 Plugin 依赖它 |
| 扩展 ChatMessageType | P0 | 2h | 支持 card/transaction/reminder/iot |
| Hub 端到端联调 | P0 | 4h | Hub↔Node 完整通信链路 |

### Phase 1 — Plugin 化 + 渠道桥接（4/11 - 4/20）

| 任务 | 优先级 | 预计工时 | 产出 |
|------|--------|----------|------|
| PluginManager 实现 | P0 | 8h | Plugin 加载/卸载/权限/沙箱 |
| 重构 Hub routes → 内置 Plugin | P1 | 12h | social/payment/task/chat 各自独立 |
| CardMessage 协议 | P0 | 4h | 交互式卡片结构定义 + 渲染 |
| OpenClaw 渠道桥接 | P0 | 8h | 飞书 ↔ ClawChat 双向通信 |
| openclaw-plugin 完善 | P1 | 4h | 注册工具 + 事件 hook |

### Phase 2 — 场景落地（4/21 - 5/10）

| 任务 | 优先级 | 预计工时 | 产出 |
|------|--------|----------|------|
| WorkPlugin | P1 | 12h | 任务状态机 + 多级审批 + 日历对接 |
| LifePlugin | P2 | 8h | 提醒增强 + 晨报 + IoT 设备注册 |
| CommercePlugin | P2 | 12h | 商品卡片 + 订单流 + 支付串联 |
| 生态伙伴 SDK 完善 | P1 | 8h | 文档 + 示例 + 脚手架 |
| PWA 完整 UI | P2 | 16h | ClawChat 客户端 |

### Phase 3 — 开放生态（5/11 - 6/30）

| 任务 | 优先级 | 预计工时 | 产出 |
|------|--------|----------|------|
| Plugin Marketplace | P1 | 20h | 发布/审核/安装/结算 |
| 能力发现协议 | P1 | 8h | 联邦能力注册 + 意图匹配 |
| PrivacyManager | P1 | 8h | 用户数据授权 + GDPR |
| IntentEngine | P2 | 12h | 消息意图提取 + 推荐匹配 |
| 首批 10 个第三方 Plugin | P2 | - | 引导开发者 |
| 企业版 | P3 | - | 私有部署 + 白标 |

### 里程碑

```
4/10  ✦ Hub 端到端跑通 + EventBus + SQLite 修复
4/20  ✦ Plugin 化完成 + 飞书桥接 + 卡片协议
5/10  ✦ 3 个场景 Plugin（工作/生活/电商）+ PWA
5/31  ✦ npm 发布 + 开发者 SDK + Marketplace 上线
6/30  ✦ 10 个第三方 Plugin + 联邦能力发现
```

## 六、数据一览

```
仓库：https://github.com/DevJackKong/JackClawOS
许可：MIT
包数：15
文件：201 .ts
代码：33,913 行
提交：94
API 路由：28
协议类型：12 模块
支持渠道：飞书/Discord/Telegram/WhatsApp/微信
支持 LLM：OpenAI/Anthropic/本地模型
加密：RSA-4096 + AES-256-GCM
联邦：跨 Hub 握手 + 消息路由 + 身份发现
```
