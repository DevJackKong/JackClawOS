# JackClaw 架构 v2 — 融合 Claude Code 设计思想

## 使命

> 让每一位 CEO 都能通过 AI 做得更好，推动人类文明到达新的高度。

JackClaw 完全开源、完全透明。所有设计思想、技术决策和架构来源都公开记录。没有黑盒，没有隐藏能力。

claude-code 的架构思想是 JackClaw 的重要灵感来源，完整记录在 `docs/claude-code-integration.md`，向 Anthropic 和开源社区致谢。

---

> 基于 claude-code 源码架构研究，对原 Hub-Node 设计进行升级。
> 核心变化：引入 **Agent 角色分层**、**TaskDelegation 协议**、**工具能力注册表**。

---

## 系统总览

```
                    ┌──────────────────────────────────────────────────────────┐
                    │                    JackClaw Hub v2                         │
                    │                                                            │
                    │  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
                    │  │  CEO Agent  │  │  Dispatcher  │  │  Tool Registry │  │
                    │  │             │  │              │  │                │  │
                    │  │ - delegates │  │ - routes     │  │ node → tools[] │  │
                    │  │ - monitors  │  │ - tracks     │  │ capability map │  │
                    │  │ - reports   │  │ - retries    │  │                │  │
                    │  └──────┬──────┘  └──────┬───────┘  └────────────────┘  │
                    │         │ TaskDelegation  │                               │
                    │  ┌──────▼──────────────────────────────────────────────┐ │
                    │  │              Hub Message Bus                         │ │
                    │  │  (TaskDelegation / ProgressUpdate / DelegationResult)│ │
                    │  └───────┬─────────────────────┬────────────────────────┘ │
                    │          │                     │                          │
                    └──────────┼─────────────────────┼──────────────────────────┘
                               │  HTTPS / WSS        │
              ┌────────────────▼──────┐   ┌──────────▼────────────────┐
              │    Node: CTO (Alice)   │   │    Node: CMO (Bob)        │
              │                       │   │                           │
              │  ┌─────────────────┐  │   │  ┌─────────────────────┐  │
              │  │  Agent Runtime  │  │   │  │   Agent Runtime     │  │
              │  │                 │  │   │  │                     │  │
              │  │ role: executive │  │   │  │ role: executive     │  │
              │  │ tools: [code,   │  │   │  │ tools: [content,    │  │
              │  │  git, test]     │  │   │  │  social, analytics] │  │
              │  └────────┬────────┘  │   │  └──────────┬──────────┘  │
              │           │           │   │             │             │
              │  ┌────────▼────────┐  │   │  ┌──────────▼──────────┐  │
              │  │  Task Executor  │  │   │  │   Task Executor     │  │
              │  │  - receive      │  │   │  │   - receive         │  │
              │  │  - permission   │  │   │  │   - permission      │  │
              │  │  - run + retry  │  │   │  │   - run + retry     │  │
              │  └────────┬────────┘  │   │  └──────────┬──────────┘  │
              │           │           │   │             │             │
              │  ┌────────▼────────┐  │   │  ┌──────────▼──────────┐  │
              │  │  Tool Registry  │  │   │  │   Tool Registry     │  │
              │  │  (local tools)  │  │   │  │   (local tools)     │  │
              │  └─────────────────┘  │   │  └─────────────────────┘  │
              └───────────────────────┘   └───────────────────────────┘
```

---

## 核心协议：TaskDelegation

从 claude-code AgentTool + SendMessageTool 中提炼的跨 Agent 任务委托协议：

### 消息类型

```typescript
// packages/protocol/src/messages.ts（扩展 v2）

// CEO → 高管：任务委托
export interface TaskDelegation {
  type: 'task_delegation'
  id: string                        // UUID，用于追踪
  from: AgentIdentity
  to: AgentIdentity
  task: DelegationTask
  delegation: DelegationControl
  createdAt: number
}

// 高管 → CEO：进度更新（流式）
export interface DelegationProgress {
  type: 'delegation_progress'
  delegationId: string
  progress: {
    stage: string                   // "analyzing" | "executing" | "verifying"
    message: string                 // 人类可读描述
    percentComplete?: number
    toolsInvoked?: string[]
    tokensUsed?: number
  }
  timestamp: number
}

// 高管 → CEO：最终结果
export interface DelegationResult {
  type: 'delegation_result'
  delegationId: string
  status: 'completed' | 'failed' | 'timeout' | 'rejected'
  result?: unknown
  error?: { code: string; message: string; retryable: boolean }
  metrics: {
    startedAt: number
    completedAt: number
    tokensUsed: number
    toolCallCount: number
    retryCount: number
  }
}

// 双向：关闭请求（对应 claude-code shutdown_request）
export interface AgentShutdownRequest {
  type: 'shutdown_request'
  requestId: string
  reason?: string
  gracePeriodMs?: number
}
```

### 身份与权限

```typescript
export interface AgentIdentity {
  role: 'ceo' | 'cto' | 'cmo' | 'coo' | 'cfo' | string
  nodeId: string
  agentId: string
}

export interface DelegationTask {
  subject: string                   // 任务标题（5-10词）
  description: string               // 详细背景
  instructions: string              // 执行指令（给 LLM 的 system prompt 补充）
  context?: Record<string, unknown> // 附加上下文（文件路径、相关数据等）
  allowedTools?: string[]           // 工具白名单，null = 使用角色默认工具集
  timeout?: number                  // 超时 ms，默认 300_000（5分钟）
}

export interface DelegationControl {
  priority: 'urgent' | 'high' | 'normal' | 'low'
  mode: 'async' | 'sync'
  maxRetries: number                // 默认 2
  requireApproval?: boolean         // true = 执行前需人工确认
  callbackUrl?: string              // 完成后 webhook 回调
}
```

---

## Hub 层：CEO Agent 设计

### 角色定位

参考 claude-code `coordinatorMode`：**CEO Agent 只做调度，不直接执行**。

```
CEO Agent 允许的操作：
  ✅ 分析目标，拆分子任务
  ✅ 通过 TaskDelegation 委派给高管 Agent
  ✅ 追踪进度，汇总结果
  ✅ 向 Owner 汇报

CEO Agent 禁止的操作：
  ❌ 直接执行代码（由 CTO Node 负责）
  ❌ 直接发布内容（由 CMO Node 负责）
  ❌ 直接读写业务文件（通过高管 Node 的工具进行）
```

### CEO Agent 实现框架

```typescript
// packages/hub/src/agents/CeoAgent.ts
export class CeoAgent {
  // 工具池：仅包含调度类工具
  private readonly ALLOWED_TOOLS = [
    'TaskDelegateTool',    // 委派任务给高管
    'DelegationStatusTool', // 查询任务状态
    'TeamMemoryTool',      // 读取跨节点记忆
    'ReportGenerateTool',  // 生成汇报
    'AskOwnerTool',        // 向 Owner 提问/汇报
  ]

  // 主循环：接收 Owner 指令，拆解并委派
  async processInstruction(instruction: string): Promise<void> {
    // 1. 拆解任务（通过 LLM）
    const plan = await this.planDecomposition(instruction)

    // 2. 并行委派无依赖任务
    const handles = await this.parallelDelegate(plan.parallelTasks)

    // 3. 等待完成后串行执行依赖任务
    for (const seqTask of plan.sequentialTasks) {
      const deps = await Promise.all(handles.filter(h => seqTask.dependsOn.includes(h.id)))
      await this.delegate(seqTask, { context: { previousResults: deps } })
    }

    // 4. 汇总结果
    await this.generateReport(plan)
  }

  // 委派单任务
  async delegate(
    task: TaskSpec,
    opts: { to?: string; context?: Record<string, unknown> } = {}
  ): Promise<DelegationHandle> {
    // 自动路由：根据任务类型选择合适的高管
    const target = opts.to ?? this.routeToExecutive(task)

    const delegation: TaskDelegation = {
      type: 'task_delegation',
      id: crypto.randomUUID(),
      from: { role: 'ceo', nodeId: this.config.nodeId, agentId: this.agentId },
      to: await this.resolveExecutive(target),
      task: {
        subject: task.subject,
        description: task.description,
        instructions: task.instructions,
        context: { ...task.context, ...opts.context },
        allowedTools: ROLE_TOOL_MAP[target],
        timeout: task.timeout ?? 300_000,
      },
      delegation: {
        priority: task.priority ?? 'normal',
        mode: 'async',
        maxRetries: 2,
      },
      createdAt: Date.now(),
    }

    return this.dispatcher.dispatch(delegation)
  }

  // 并行委派（无依赖任务批量处理）
  async parallelDelegate(tasks: TaskSpec[]): Promise<DelegationHandle[]> {
    return Promise.all(tasks.map(t => this.delegate(t)))
  }

  // 任务路由规则
  private routeToExecutive(task: TaskSpec): string {
    const keywords = task.subject.toLowerCase()
    if (/(code|tech|api|bug|deploy)/.test(keywords)) return 'cto'
    if (/(market|content|social|brand)/.test(keywords)) return 'cmo'
    if (/(ops|process|team|hr)/.test(keywords)) return 'coo'
    if (/(finance|budget|cost|revenue)/.test(keywords)) return 'cfo'
    return 'cto'  // 默认路由
  }
}

// 角色默认工具映射（参考 claude-code ASYNC_AGENT_ALLOWED_TOOLS）
const ROLE_TOOL_MAP: Record<string, string[]> = {
  cto: ['BashTool', 'FileEditTool', 'FileReadTool', 'GlobTool', 'GrepTool', 'WebFetchTool'],
  cmo: ['WebFetchTool', 'WebSearchTool', 'FileWriteTool', 'BashTool'],
  coo: ['BashTool', 'FileReadTool', 'FileWriteTool', 'TaskCreateTool'],
  cfo: ['BashTool', 'FileReadTool', 'WebFetchTool'],
}
```

---

## Node 层：高管 Agent 设计

### 任务执行器（Task Executor）

参考 claude-code `LocalAgentTask` 状态机：

```typescript
// packages/node/src/executor/TaskExecutor.ts
export type ExecutionStatus =
  | { status: 'pending' }
  | { status: 'running'; startedAt: number; stage: string }
  | { status: 'completed'; completedAt: number; result: unknown }
  | { status: 'failed'; error: string; retryCount: number }
  | { status: 'rejected'; reason: string }

export class TaskExecutor {
  async receive(delegation: TaskDelegation): Promise<void> {
    // 权限检查（参考 claude-code ToolPermissionContext）
    const permission = await this.checkDelegationPermission(delegation)
    if (!permission.allowed) {
      await this.report(delegation.id, {
        type: 'delegation_result',
        status: 'rejected',
        error: { code: 'PERMISSION_DENIED', message: permission.reason, retryable: false },
      })
      return
    }

    // 如果 requireApproval，先等待本地用户确认
    if (delegation.delegation.requireApproval) {
      const approved = await this.requestLocalApproval(delegation)
      if (!approved) {
        await this.report(delegation.id, { type: 'delegation_result', status: 'rejected' })
        return
      }
    }

    // 异步执行（不阻塞 WebSocket 接收）
    this.runWithRetry(delegation).catch(console.error)
  }

  private async runWithRetry(
    delegation: TaskDelegation,
    retryCount = 0
  ): Promise<void> {
    const maxRetries = delegation.delegation.maxRetries ?? 2
    const taskId = delegation.id

    try {
      // 限制工具池（安全边界）
      const tools = this.buildToolPool(delegation.task.allowedTools)

      // 运行 Agent 循环
      const result = await this.agentRuntime.run({
        systemPrompt: this.buildSystemPrompt(delegation),
        instructions: delegation.task.instructions,
        context: delegation.task.context,
        tools,
        timeout: delegation.task.timeout,
        onProgress: (p) => this.reportProgress(taskId, p),
        signal: this.createAbortSignal(taskId, delegation.task.timeout),
      })

      await this.report(taskId, {
        type: 'delegation_result',
        status: 'completed',
        result,
        metrics: { tokensUsed: result.tokensUsed, toolCallCount: result.toolCalls },
      })

    } catch (err) {
      const error = toError(err)
      if (retryCount < maxRetries && isRetryableError(error)) {
        // 指数退避重试
        await sleep(Math.pow(2, retryCount) * 1000)
        return this.runWithRetry(delegation, retryCount + 1)
      }

      await this.report(taskId, {
        type: 'delegation_result',
        status: 'failed',
        error: { code: 'EXECUTION_ERROR', message: error.message, retryable: false },
      })
    }
  }
}
```

---

## 工具能力注册表（Tool Registry）

每个 Node 启动时向 Hub 注册自己的工具能力：

```typescript
// packages/protocol/src/tools.ts
export interface NodeToolRegistration {
  type: 'tool_registration'
  nodeId: string
  role: string
  tools: ToolCapability[]
  registeredAt: number
}

export interface ToolCapability {
  name: string
  version: string
  description: string
  // 工具声明自己需要的权限（参考 claude-code ToolPermissionContext）
  requiredPermissions: Array<{
    resource: 'filesystem' | 'network' | 'shell' | 'llm'
    level: 'read' | 'write' | 'execute'
    scope?: string
  }>
}

// Hub 查询接口：CEO 可以问"哪个 Node 有执行 git push 的能力"
export interface ToolQuery {
  requiredTools?: string[]
  requiredPermissions?: ToolCapability['requiredPermissions']
  role?: string
}
```

---

## 数据流

### CEO 委派任务完整流程

```
Owner → Hub (HTTP)
    │
    ▼
CEO Agent (分析+拆解)
    │
    ├─ parallelDelegate([tech_task, content_task])
    │       │                    │
    │       ▼                    ▼
    │  Hub Dispatcher       Hub Dispatcher
    │       │                    │
    │       ▼                    ▼
    │  CTO Node             CMO Node
    │  TaskExecutor         TaskExecutor
    │       │                    │
    │       ├─ progress report   ├─ progress report
    │       │                    │
    │       ▼                    ▼
    │  DelegationResult     DelegationResult
    │       │                    │
    └───────┴────────────────────┘
                  │
                  ▼
           CEO Agent (汇总)
                  │
                  ▼
           Owner Report (飞书/消息)
```

### 权限检查流程（参考 claude-code 分层权限）

```
收到 TaskDelegation
    │
    ├─ 检查 from.role 是否有权委派给 to.role？
    ├─ 检查 task.allowedTools 是否在 Node 工具白名单内？
    ├─ 检查 task.context 中无敏感数据泄露？
    ├─ delegation.requireApproval == true → 弹出本地确认
    │
    └─ 全部通过 → 开始执行
```

---

## 与 v1 的关键差异

| 维度 | v1 | v2 |
|------|----|----|
| 任务下发 | `POST /api/tasks` 简单推送 | `TaskDelegation` 结构化协议，含进度回调 |
| Hub 角色 | 被动路由器 | 主动 CEO Agent，主动拆解+调度 |
| Node 角色 | 接收+执行，无角色区分 | 高管 Agent，有角色专属工具池 |
| 工具管理 | 静态配置 | 动态注册表，Hub 可查询各 Node 能力 |
| 错误处理 | 无重试 | 状态机 + 指数退避重试 |
| Agent 通信 | 无 | SendMessage 协议（广播/定向） |
| 记忆系统 | 各 Node 独立 | 跨节点语义检索（Hub TeamMemoryIndex） |
| 并行执行 | 手动多请求 | `parallelDelegate()` 原语 |

---

## 部署拓扑（v2）

```
云端 Hub（CEO Agent 驻留）
    ├── CTO Node（技术执行，git/code/test 工具）
    ├── CMO Node（营销执行，内容/社媒工具）
    ├── COO Node（运营执行，任务/日程工具）
    └── CFO Node（财务执行，数据/报表工具）
```

各 Node 可以在不同机器、不同操作系统上运行，通过 Hub 统一调度。

---

## 技术选型（v2 新增）

| 新增组件 | 技术选择 | 说明 |
|---------|---------|------|
| 消息协议 | Zod v4 结构化验证 | 参考 claude-code 所有工具输入用 Zod |
| 权限模型 | 自研（参考 ToolPermissionContext） | 不可变上下文，防运行时篡改 |
| 任务状态机 | XState 或自研 | 参考 claude-code TaskState 联合类型 |
| 进度追踪 | SSE / WebSocket 推送 | 非轮询，参考 claude-code progress tracker |
| 记忆检索 | LLM-based（Sonnet sideQuery） | 参考 claude-code memdir findRelevantMemories |
