# 核心概念

## 总览

JackClaw 的核心对象可以概括为：

- **Hub**：总部 / 调度中心
- **Node**：运行时节点 / AI 员工容器
- **Agent**：对外呈现的智能体身份
- **Memory**：多层记忆系统

## Hub

Hub 是整个系统的中心节点。

### Hub 负责什么

- 接收人类命令
- 路由任务到合适的 Node
- 汇总日报与状态
- 暴露 REST API 与 WebSocket
- 管理 ClawChat、任务、审批、审计、通知
- 承载 Dashboard 与健康检查

### Hub 的典型接口

- `/api/register`：节点注册
- `/api/reports`：接收节点汇报
- `/api/nodes`：查询节点列表
- `/api/tasks`：异步任务
- `/api/chat`：消息与线程
- `/health`：健康检查

### 可以把 Hub 理解成

> AI 组织的“总部 + API Gateway + 消息中台 + 审批中心”。

## Node

Node 是实际执行工作的运行单元。

### Node 负责什么

- 接入 LLM 提供商
- 执行命令与任务
- 持有自己的身份与私钥
- 维护本地私有记忆
- 定期向 Hub 汇报
- 通过 SDK 暴露插件能力

### Node 的特点

- 可以独立上线/下线
- 可以有不同能力标签
- 可以被 Hub 分配不同类型任务
- 可以通过 `@jackclaw/sdk` 扩展命令、计划任务、钩子

### 可以把 Node 理解成

> 真正干活的 AI 员工进程。

## Agent

Agent 是系统中的“智能体身份”。

在代码实现上，Agent 不一定总是单独作为一个 package 存在；它更多是 **Hub + Node + 身份 + 能力 +通信渠道** 的组合结果。

### Agent 通常具备

- 唯一 ID / handle
- 名称与元数据
- 能力声明
- 任务执行能力
- 与其他 Agent 的消息能力
- 记忆与关系上下文

### Hub 视角与 Node 视角

- **Hub 视角**：Agent 是可路由、可观测、可审批的组织成员
- **Node 视角**：Agent 是一个运行中的身份载体，拥有命令、记忆、调度与外部连接

## Memory

README 中明确描述了 JackClaw 的 **4 层记忆模型**。

| 层级 | 含义 | 作用 |
| --- | --- | --- |
| L1 | Working memory | 当前任务上下文、瞬时状态 |
| L2 | Local notebook | 节点本地学习与经验 |
| L3 | Shared knowledge | 团队共享知识，需要授权 |
| L4 | Cloud / HQ sync | 同步到总部的长期记忆 |

### Memory 设计目标

- 让 Agent 有连续性
- 减少重复提示词与上下文搬运
- 支持私有记忆与共享记忆并存
- 让知识能在组织中传播

### Memory 与安全

- 默认私有
- 共享需要授权
- Hub 主要负责路由与托管，不等于能读取所有明文

## 四者关系

```text
Human / CEO
   ↓
  Hub
   ↓
 Node ──> Agent identity
   ↓
 Memory
```

更准确地说：

- **Hub** 决定任务发给谁
- **Node** 决定怎么执行
- **Agent** 决定以谁的身份对外协作
- **Memory** 决定是否能持续学习和记住

## 一句话总结

- **Hub**：调度中心
- **Node**：执行进程
- **Agent**：智能体身份
- **Memory**：持续上下文系统
