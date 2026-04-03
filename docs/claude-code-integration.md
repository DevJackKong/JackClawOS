# Claude Code 架构融合分析

> 基于 Claude Code 源码快照（2026-03-31 公开）的架构研究，提炼可融合进 JackClaw 的核心设计思想。

---

## 一、Claude Code 核心架构亮点

### 1. 自描述工具系统（Self-Describing Tool System）

每个工具都是自包含模块，实现统一接口：**name / inputSchema（Zod）/ description / prompt / call**。

```typescript
// claude-code: Tool.ts 核心接口
interface ToolDef<TInput, TOutput> {
  name: string
  inputSchema: ZodSchema<TInput>    // 结构化校验
  description(): Promise<string>    // LLM 可读描述
  prompt(): Promise<string>         // 使用指南
  call(input: TInput, ctx: ToolUseContext): Promise<TOutput>
  checkPermissions(input: TInput, ctx: ToolPermissionContext): PermissionResult
}
```

**JackClaw 融合点：** Node 上的 Agent 工具库统一注册机制，Hub 可以查询每个 Node 拥有哪些工具能力。

---

### 2. 分层权限模型（Layered Permission Model）

权限分为 5 层，每次工具调用都经过权限检查流水线：

```
default → plan → auto → bypassPermissions → alwaysDeny
```

- `alwaysAllowRules` / `alwaysDenyRules` / `alwaysAskRules` 三类规则集
- 权限上下文 `ToolPermissionContext` 不可变（`DeepImmutable`），防止运行时篡改
- 后台 Agent 设置 `shouldAvoidPermissionPrompts=true`，自动拒绝需要交互的操作

**JackClaw 融合点：** 成员 Node 执行 CEO 下发任务时，按权限等级决定是否需要本地用户确认。

---

### 3. AgentTool：子 Agent 生命周期管理

`AgentTool` 是系统中最复杂的工具，实现了完整的子 Agent 生命周期：

```
spawn → register → run loop → progress tracking → finalize / fail
```

关键机制：
- **自动后台化**：超过 120s 未完成自动转入后台（`getAutoBackgroundMs()`）
- **进度追踪**：`createProgressTracker()` 实时汇报 token 消耗和状态
- **远程 Agent**：`checkRemoteAgentEligibility()` 判断是否可以调度到远端执行
- **Worktree 隔离**：为每个 Agent 创建独立 git worktree，防止文件冲突

**JackClaw 融合点：** CEO Agent 通过类似机制将子任务委托给高管 Agent，并追踪完成状态。

---

### 4. Coordinator 模式（多 Agent 协调）

`isCoordinatorMode()` 开关切换 Agent 角色：

```typescript
// 协调者模式：只允许调度工具，不直接执行
const COORDINATOR_TOOLS = [AgentTool, TeamCreateTool, SendMessageTool, ...]

// Worker 模式：只允许执行工具，不能再生子 Agent
const WORKER_TOOLS = [BashTool, FileEditTool, GrepTool, ...]
```

- Coordinator 负责分解任务、分配 Worker
- Worker 只执行，通过 `SendMessageTool` 回报结果
- `TeamCreateTool` / `TeamDeleteTool` 动态创建/销毁 Agent 团队

**JackClaw 融合点：** Hub 层作为 Coordinator，Node 层作为 Worker，复用相同的职责分离模式。

---

### 5. SendMessageTool：Agent 间消息路由

结构化的点对点和广播通信协议：

```typescript
interface MessageInput {
  to: string          // 目标 Agent 名称，"*" 为广播
  summary: string     // UI 预览摘要（5-10词）
  message: string | StructuredMessage  // 消息内容
}

// 结构化消息类型
type StructuredMessage =
  | { type: 'shutdown_request'; reason?: string }
  | { type: 'shutdown_response'; request_id: string; approve: boolean }
  | { type: 'plan_approval_response'; request_id: string; approve: boolean }
```

消息路由通过 `teammateMailbox`（邮箱模式），支持 UDS socket / Bridge / 广播。

**JackClaw 融合点：** Node 间消息协议参考此设计，增加 `task_delegation` / `task_result` 消息类型。

---

### 6. 记忆系统（Semantic Memory Retrieval）

`memdir/` 实现了向量无关的语义记忆检索：

```
用户查询 → sideQuery(Sonnet) → 扫描 memory 文件头 → 返回最相关 ≤5 条
```

- 每个 memory 文件有结构化 header（name + description）
- 用轻量 LLM（Sonnet）做选择，而非向量检索
- 不重复加载已展示的记忆（`alreadySurfaced` Set 去重）

**JackClaw 融合点：** 每个 Node 维护本地 memdir，Hub 汇聚跨节点共享记忆（团队知识库）。

---

### 7. Task 类型系统（多态任务状态机）

任务类型是联合类型，每种类型有独立状态机：

```typescript
type TaskState =
  | LocalShellTaskState       // 本地 shell 命令
  | LocalAgentTaskState       // 本地子 Agent
  | RemoteAgentTaskState      // 远程 Agent（跨机器）
  | InProcessTeammateTaskState // 同进程 teammate
  | LocalWorkflowTaskState    // 工作流编排
  | DreamTaskState            // 预设/梦想任务
```

状态转换：`pending → running → completed / failed`

**JackClaw 融合点：** Hub Dispatcher 采用相同多态设计，支持本地节点任务和跨节点远程任务。

---

### 8. 懒加载 + 并行预取（启动优化）

```typescript
// 并行预取：在 import 评估前即启动
startMdmRawRead()         // MDM 配置
startKeychainPrefetch()   // 密钥链读取

// 懒加载：按需动态 import
const OtelModule = feature('TELEMETRY')
  ? await import('./telemetry.js')
  : null
```

**JackClaw 融合点：** Node 启动时并行初始化 LLM 连接 + Hub 连接 + 本地工具扫描。

---

## 二、融合后 JackClaw 的能力提升

| 能力维度 | 融合前 | 融合后 |
|---------|-------|-------|
| 任务委托 | REST 推送，无状态追踪 | 结构化 TaskDelegation 协议，含进度回调 |
| 工具发现 | 静态配置 | 动态查询 Node 工具能力注册表 |
| Agent 通信 | 无 Agent 间消息 | SendMessage 协议，支持广播和定向 |
| 权限控制 | JWT 认证 + 简单鉴权 | 分层权限模型，任务级细粒度控制 |
| 记忆共享 | 各 Node 独立 | 跨节点语义记忆检索 |
| 并行任务 | 单节点串行 | Coordinator 模式调度多 Node 并行 |
| 错误恢复 | 无重试机制 | 任务状态机 + 自动重试 + 优雅降级 |

---

## 三、具体代码改进建议

### 3.1 JackClaw Tool 注册接口

```typescript
// packages/protocol/src/tools.ts
export interface JackClawTool<TInput = unknown, TOutput = unknown> {
  name: string
  version: string
  description: string
  inputSchema: z.ZodSchema<TInput>
  
  // 权限声明：工具声明自己需要哪些权限
  requiredPermissions: ToolPermission[]
  
  // 执行
  execute(input: TInput, ctx: ToolContext): Promise<TOutput>
  
  // 可选：进度汇报
  onProgress?: (progress: ToolProgress) => void
}

export interface ToolPermission {
  resource: 'filesystem' | 'network' | 'shell' | 'llm' | 'memory'
  level: 'read' | 'write' | 'execute'
  scope?: string  // 如 "/tmp/**" 限制文件系统范围
}

// Node 工具注册表
export interface NodeToolRegistry {
  nodeId: string
  tools: Array<{
    name: string
    version: string
    description: string
    permissions: ToolPermission[]
  }>
  lastUpdated: number
}
```

### 3.2 任务委托协议（TaskDelegation Protocol）

```typescript
// packages/protocol/src/delegation.ts
export interface TaskDelegation {
  id: string                    // UUID
  type: 'delegation'
  from: AgentIdentity           // 委派者（CEO / 上级 Agent）
  to: AgentIdentity             // 受委派者（高管 / 执行 Agent）
  
  task: {
    subject: string             // 任务标题
    description: string         // 详细描述
    instructions: string        // 执行指令
    context?: Record<string, unknown>  // 补充上下文
    tools?: string[]            // 允许使用的工具名列表
    timeout?: number            // 超时 ms
  }
  
  delegation: {
    priority: 'urgent' | 'high' | 'normal' | 'low'
    mode: 'async' | 'sync'     // async=非阻塞，sync=等待结果
    maxRetries?: number
    callbackUrl?: string        // 完成后回调（Hub 端点）
  }
  
  createdAt: number
}

export interface TaskDelegationResult {
  delegationId: string
  status: 'completed' | 'failed' | 'timeout' | 'rejected'
  result?: unknown
  error?: string
  metrics: {
    startedAt: number
    completedAt: number
    tokensUsed?: number
    toolCallCount?: number
  }
}
```

### 3.3 CEO Agent → 高管 Agent 委派接口

```typescript
// packages/hub/src/agents/CeoAgent.ts
export class CeoAgent {
  private executives: Map<string, ExecutiveAgent>
  
  // 委派任务给指定高管 Agent
  async delegate(task: TaskSpec, to: 'cto' | 'cmo' | 'coo' | string): Promise<DelegationHandle> {
    const delegation: TaskDelegation = {
      id: generateId(),
      type: 'delegation',
      from: { role: 'ceo', nodeId: this.nodeId },
      to: { role: to, nodeId: await this.resolveNodeId(to) },
      task: {
        subject: task.subject,
        description: task.description,
        instructions: task.instructions,
        tools: this.allowedToolsFor(to),  // 按角色限定工具
      },
      delegation: {
        priority: task.priority ?? 'normal',
        mode: 'async',
        maxRetries: 2,
        callbackUrl: `${this.hubUrl}/api/delegations/${id}/result`,
      },
      createdAt: Date.now(),
    }
    
    // 通过 Hub Dispatcher 路由到目标 Node
    return this.dispatcher.send(delegation)
  }
  
  // 并行委派给多个高管
  async parallelDelegate(tasks: Array<{ task: TaskSpec; to: string }>): Promise<DelegationHandle[]> {
    return Promise.all(tasks.map(({ task, to }) => this.delegate(task, to)))
  }
}
```

### 3.4 Node 端任务接收 + 执行

```typescript
// packages/node/src/executor/TaskExecutor.ts
export class TaskExecutor {
  async receive(delegation: TaskDelegation): Promise<void> {
    // 1. 权限检查
    const permitted = await this.checkPermissions(delegation)
    if (!permitted.allowed) {
      await this.reportResult(delegation.id, { status: 'rejected', error: permitted.reason })
      return
    }
    
    // 2. 注册任务状态
    const task = await this.taskRegistry.create({
      id: delegation.id,
      status: 'pending',
      delegation,
    })
    
    // 3. 异步执行（不阻塞接收循环）
    this.runAsync(task).catch(err => {
      this.reportResult(delegation.id, { status: 'failed', error: err.message })
    })
  }
  
  private async runAsync(task: LocalTask): Promise<void> {
    task.status = 'running'
    task.startedAt = Date.now()
    
    try {
      // 构建工具池（仅包含 delegation.task.tools 允许的工具）
      const tools = this.buildToolPool(task.delegation.task.tools)
      
      // 运行 Agent 循环
      const result = await this.agentRuntime.run({
        instructions: task.delegation.task.instructions,
        context: task.delegation.task.context,
        tools,
        timeout: task.delegation.task.timeout,
        onProgress: (p) => this.reportProgress(task.id, p),
      })
      
      await this.reportResult(task.id, {
        status: 'completed',
        result,
        metrics: { startedAt: task.startedAt, completedAt: Date.now() },
      })
    } catch (err) {
      if (task.retryCount < (task.delegation.delegation.maxRetries ?? 0)) {
        await this.retry(task)
      } else {
        await this.reportResult(task.id, { status: 'failed', error: errorMessage(err) })
      }
    }
  }
}
```

### 3.5 跨节点语义记忆共享

```typescript
// packages/hub/src/memory/TeamMemoryIndex.ts
export class TeamMemoryIndex {
  // 每个 Node 上报自己的记忆文件索引
  async indexNode(nodeId: string, memories: MemoryHeader[]): Promise<void> {
    await this.db.upsertMemories(nodeId, memories)
  }
  
  // CEO/高管查询跨节点记忆
  async findRelevant(query: string, limit = 5): Promise<RelevantMemory[]> {
    // 用轻量 LLM 选择最相关的记忆（参考 claude-code memdir 设计）
    const candidates = await this.db.getAllHeaders()
    const selected = await this.sideQuery(query, candidates)
    return selected.slice(0, limit)
  }
}
```

---

## 四、总结

Claude Code 的核心架构哲学是：

1. **工具即接口**：所有能力通过统一工具接口暴露，LLM 通过工具调用来编排
2. **权限优先**：每次操作都经过权限检查，而非事后审计
3. **角色分离**：Coordinator 只调度，Worker 只执行，职责清晰
4. **消息即协议**：Agent 间通信通过结构化消息，而非直接调用

JackClaw 融合这些思想后，从"任务推送系统"升级为"多 Agent 协作操作系统"。
