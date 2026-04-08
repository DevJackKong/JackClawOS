# @jackclaw/sdk API 参考

源码入口：`packages/jackclaw-sdk/src/index.ts`

`@jackclaw/sdk` 是 JackClaw 的最小扩展面，主要用于：

- 定义插件
- 定义节点
- 声明命令
- 声明定时任务
- 注册生命周期钩子
- 在测试中构造 mock context

## 安装

```bash
npm install @jackclaw/sdk
```

## 核心导出

## `definePlugin(definition)`

定义一个插件。

```ts
import { definePlugin } from '@jackclaw/sdk'

export default definePlugin({
  name: 'my-plugin',
  version: '1.0.0',
  commands: {
    hello: async (ctx) => ({
      text: `Hello from ${ctx.node.name}!`,
    }),
  },
})
```

### 约束

- `name` 必填
- `version` 必填
- 缺失时会抛错

## `defineNode(definition)`

定义一个节点。相比插件，多了 `capabilities` 概念。

```ts
import { defineNode } from '@jackclaw/sdk'

export default defineNode({
  name: 'research-node',
  version: '1.0.0',
  capabilities: ['report', 'command'],
  commands: {
    status: async (ctx) => ({ text: `${ctx.node.name} is online` }),
  },
})
```

## 类型系统

### `NodeInfo`

```ts
interface NodeInfo {
  id: string
  name: string
  version: string
  tags: string[]
  metadata: Record<string, unknown>
}
```

### `PluginInfo`

```ts
interface PluginInfo {
  name: string
  version: string
  description?: string
}
```

### `CommandResult`

命令返回值。

```ts
interface CommandResult {
  text?: string
  data?: Record<string, unknown>
  markdown?: string
  items?: Array<{ label: string; value: string | number | boolean }>
}
```

### `ReportPayload`

定时任务上报结构。

```ts
interface ReportPayload {
  summary: string
  items?: Array<{ label: string; value: string | number | boolean }>
  data?: Record<string, unknown>
}
```

## 上下文对象

### `CommandContext`

命令执行时可获得：

- `node`
- `plugin`
- `args`
- `input`
- `userId`
- `userName`
- `log`
- `store`

### `ScheduleContext`

定时任务上下文，除了基础字段，还提供：

- `report(payload)`：发送结构化报告
- `notify(text)`：发送纯文本通知

### `HookContext`

生命周期钩子上下文，提供：

- `node`
- `plugin`
- `log`
- `store`

## 存储接口

### `PluginStore`

```ts
interface PluginStore {
  get<T = unknown>(key: string): T | undefined
  set(key: string, value: unknown): void
  delete(key: string): void
  clear(): void
}
```

适合保存插件级状态。

## 处理器类型

```ts
type CommandHandler = (ctx: CommandContext) => Promise<CommandResult | void>
type ScheduleHandler = (ctx: ScheduleContext) => Promise<void>
type HookHandler = (ctx: HookContext) => Promise<void>
```

## 定时任务

### `ScheduleDefinition`

```ts
interface ScheduleDefinition {
  daily?: ScheduleHandler
  hourly?: ScheduleHandler
  minutely?: ScheduleHandler
  cron?: Record<string, ScheduleHandler>
}
```

示例：

```ts
schedule: {
  daily: async (ctx) => {
    await ctx.report({ summary: 'Daily summary ready' })
  },
  cron: {
    '0 9 * * 1': async (ctx) => {
      await ctx.notify('Weekly kickoff')
    },
  },
}
```

## 生命周期钩子

### `HooksDefinition`

```ts
interface HooksDefinition {
  onLoad?: HookHandler
  onShutdown?: HookHandler
  onError?: (error: Error, ctx: HookContext) => Promise<void>
}
```

## 定义对象

### `PluginDefinition`

```ts
interface PluginDefinition {
  name: string
  version: string
  description?: string
  commands?: Record<string, CommandHandler>
  schedule?: ScheduleDefinition
  hooks?: HooksDefinition
}
```

### `NodeDefinition`

```ts
interface NodeDefinition extends PluginDefinition {
  capabilities?: string[]
}
```

## 测试辅助

### `createMockCommandContext(overrides?)`

用于单元测试命令处理器。

### `createMockScheduleContext(overrides?)`

用于单元测试定时任务。

## 附加数据类型

SDK 还暴露了两类重要业务类型：

### ClawChat

- `ChatMessageType`
- `ChatMessage`
- `ChatThread`

其中 `ChatMessageType` 支持：

- `text`
- `human`
- `task`
- `ask`
- `broadcast`
- `reply`
- `ack`
- `plan-result`
- `card`
- `transaction`
- `media`
- `reminder`
- `calendar`
- `approval`
- `system`
- `x-*` 自定义扩展

### OwnerMemory

- `OwnerMemoryType`
- `OwnerMemoryEntry`
- `RelationshipStats`
- `OwnerProfile`

适合在插件和 SDK 消费端统一处理“用户画像 / 关系记忆 / 偏好 / 里程碑”等数据。

## 最小插件示例

```ts
import { definePlugin } from '@jackclaw/sdk'

export default definePlugin({
  name: 'hello-plugin',
  version: '0.1.0',
  description: 'A minimal JackClaw plugin',
  commands: {
    hello: async (ctx) => ({
      text: `Hello ${ctx.userName ?? 'there'} from ${ctx.node.name}`,
    }),
  },
  hooks: {
    onLoad: async (ctx) => {
      ctx.log.info('plugin loaded')
    },
  },
})
```
