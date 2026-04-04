# JackClaw 架构完善分析

> 基于现有代码审计（14包 / 4801行 Hub routes / Protocol 完整度 ~70%）

## 现有能力（✅ 已实现）

| 模块 | 状态 | 覆盖场景 |
|------|------|----------|
| Protocol types | ✅ 完整 | 消息/加密/身份/联邦/社交/支付/回执 |
| Hub routes | ✅ 基础 | chat/federation/payment/social/tasks/presence |
| Memory | ✅ 4分类+L1缓存 | 私有/共享/教学记忆 |
| LLM Gateway | ✅ 多模型路由 | 多 provider 统一调用 |
| Payment Vault | ✅ 合规引擎 | 6司法区规则 |
| Human-in-Loop | ✅ L0-L3自主度 | 高风险操作审批 |
| Concierge | ✅ 日程+提醒 | 中文自然语言时间 |
| Federation | ✅ 握手+路由 | 跨 Hub 消息 |
| ClawChat | ✅ WS+离线+群聊 | 基础通信 |

## 缺口分析（按场景）

### 🔴 关键缺失（阻塞多场景）

#### 1. 消息类型系统太窄
**现状：** `ChatMessageType = 'human' | 'task' | 'ask' | 'broadcast' | 'reply' | 'ack' | 'plan-result'`
**问题：** 无法表达卡片、交易、IoT、健康、提醒等结构化消息
**方案：**
```ts
// 扩展为可枚举 + 可扩展
type ChatMessageType =
  | 'text' | 'card' | 'task' | 'transaction' | 'media'
  | 'reminder' | 'health' | 'iot' | 'calendar' | 'approval'
  | 'broadcast' | 'reply' | 'ack' | 'system'
  | `x-${string}`  // 自定义扩展
```

#### 2. 事件总线不存在
**现状：** 消息处理是 ChatWorker 里的硬编码逻辑
**问题：** 无法让多个 Plugin 订阅同一事件，无法扩展
**方案：** 需要 `EventBus` — 每条消息触发事件，Plugin 按需订阅
```
msg.received → [AuthPlugin, MemoryPlugin, SkillRouter, AnalyticsPlugin, ...]
msg.sent → [DeliveryPlugin, ReceiptPlugin]
user.online → [PresencePlugin, NotificationPlugin]
```

#### 3. Plugin 系统缺失
**现状：** 所有功能硬编码在 Hub routes 里
**问题：** 加新场景 = 改 Hub 代码，无法第三方扩展
**方案：** 需要 `PluginManager`
```ts
interface JackClawPlugin {
  name: string
  version: string
  events: string[]          // 订阅哪些事件
  onEvent(event: Event): Promise<void>
  onCommand?(cmd: string, args: any): Promise<any>
}
```

### 🟡 场景级缺口

#### 4. 工作场景
| 需要 | 现状 | 优先级 |
|------|------|--------|
| 任务分配+跟踪 | tasks.ts 有基础 CRUD | 🟡 需加状态机+分配链 |
| 审批流 | human-review.ts 只有单层 | 🟡 需多级审批链 |
| 文档协作 | 无 | 🔴 需 DocPlugin |
| 日历集成 | concierge 有时间解析 | 🟡 需对接外部日历 API |
| 会议纪要 | 无 | 🟠 可后期加 |

#### 5. 生活场景
| 需要 | 现状 | 优先级 |
|------|------|--------|
| IoT 控制 | 无 | 🟡 需 IoTPlugin + 设备注册 |
| 健康数据 | 无 | 🟠 需 HealthPlugin + 数据源适配 |
| 出行/物流 | 无 | 🟠 需第三方 API 集成 |
| 财务记账 | payment-vault 只管支付 | 🟡 需 FinancePlugin |
| 智能推荐 | 无 | 🟠 需意图引擎 |

#### 6. 电商场景
| 需要 | 现状 | 优先级 |
|------|------|--------|
| 商品卡片 | ChatMessage 无 card 类型 | 🔴 依赖消息类型扩展 |
| 交互式操作 | 无 inline action | 🔴 需 CardAction 协议 |
| 订单流 | payment-vault 有支付 | 🟡 需 OrderPlugin 串联 |
| 物流跟踪 | 无 | 🟠 第三方 API |

#### 7. 广告/推荐场景
| 需要 | 现状 | 优先级 |
|------|------|--------|
| 意图标签 | 无 | 🟡 消息 metadata 扩展 |
| 匹配引擎 | 无 | 🟠 后期 |
| 用户授权 | 无隐私控制 | 🔴 需 PrivacyPlugin |

#### 8. 娱乐场景
| 需要 | 现状 | 优先级 |
|------|------|--------|
| AI 角色 | social.ts 有 SocialProfile | 🟡 扩展 persona 字段 |
| 多人互动 | groups.ts 有群聊基础 | 🟡 需游戏状态同步 |
| 内容生成 | LLM Gateway 有 | ✅ 可用 |

### 🟢 跨场景基础设施

#### 9. 缺少的基础层

| 基础设施 | 用途 | 当前状态 |
|----------|------|----------|
| **EventBus** | 所有 Plugin 的神经系统 | ❌ 不存在 |
| **PluginManager** | 加载/卸载/权限管理 | ❌ 不存在 |
| **CardMessage 协议** | 交互式卡片（电商/审批/IoT） | ❌ 不存在 |
| **IntentEngine** | 消息意图提取（广告/推荐/路由） | ❌ 不存在 |
| **PrivacyManager** | 用户数据授权控制 | ❌ 不存在 |
| **SQLite 持久化** | 当前 better-sqlite3 编译失败 | 🔴 用 JSONL fallback |
| **渠道桥接** | 飞书/Discord/微信 ↔ ClawChat | ❌ 不存在 |

## 优先级排序（建议实施顺序）

### Phase 0 — 地基（本周）
1. **修 SQLite** — better-sqlite3 重新编译或换 libsql
2. **EventBus** — 核心 50 行，所有后续 Plugin 依赖它
3. **扩展消息类型** — ChatMessageType 加 card/transaction/reminder/iot

### Phase 1 — Plugin 框架 + 卡片（下周）
4. **PluginManager** — 加载/卸载/事件分发
5. **CardMessage 协议** — 定义交互式卡片结构
6. **渠道桥接** — 至少飞书 ↔ ClawChat

### Phase 2 — 工作+生活（2周内）
7. **WorkPlugin** — 任务状态机 + 多级审批 + 日历集成
8. **LifePlugin** — 提醒增强 + IoT 设备注册 + 晨报

### Phase 3 — 电商+社交增强（1个月内）
9. **CommercePlugin** — 商品卡片 + 订单流 + 支付串联
10. **PrivacyManager** — 用户授权控制
11. **IntentEngine** — 意图提取 + 推荐匹配

### Phase 4 — 联邦+开放平台（Q3）
12. 第三方 Plugin 市场
13. 跨 Hub 商品/服务发现
14. 广告系统

## 核心洞察

**现有代码质量很高**——加密/签名/合规/联邦都做了，Protocol 设计严谨。

**最大瓶颈是架构模式**：当前是"所有功能硬编码在 Hub"，需要转向"EventBus + Plugin"模式。这一步做完，所有场景都是"写个 Plugin"的事。

**一句话：Hub 从"功能集合"变成"消息管道 + Plugin 运行时"。**
