/**
 * agent-tool.ts — JackClaw Node 能力注册为 OpenClaw 可调用工具
 *
 * 借鉴 Claude Code AgentTool 模式，将每个 JackClaw 能力封装为标准工具对象，
 * 让 OpenClaw 的 LLM agent 可以直接 call_tool 调用。
 *
 * 注册方式（在 plugin.ts 中）：
 *
 *   import { getJackClawTools } from './agent-tool.js'
 *   for (const tool of getJackClawTools(nodeId)) {
 *     api.registerTool(tool)
 *   }
 */

const DEFAULT_HUB_URL = process.env['JACKCLAW_HUB_URL'] ?? 'https://hub.jackclaw.ai'
const CEO_TOKEN = process.env['JACKCLAW_CEO_TOKEN'] ?? ''

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface OpenClawTool {
  /** Unique tool name; must be snake_case, prefixed with "jackclaw_" */
  name: string
  /** Short human-readable description shown to the LLM */
  description: string
  /** JSON Schema for the tool's input parameters */
  parameters: Record<string, unknown>
  /** Actual implementation called when the tool is invoked */
  handler: (params: unknown) => Promise<unknown>
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function hubRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  token?: string,
): Promise<T> {
  const url = `${DEFAULT_HUB_URL}${path}`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const bearerToken = token ?? CEO_TOKEN
  if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Hub ${method} ${path} → ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

/**
 * readChatJwt — 从 ~/.jackclaw/clawchat-auth.json 读取 JWT
 *
 * 文件结构：{ "token": "eyJ..." }
 * 读取失败时静默返回空字符串（允许降级到 CEO_TOKEN）。
 */
async function readChatJwt(): Promise<string> {
  try {
    const os = await import('os')
    const path = await import('path')
    const fs = await import('fs/promises')
    const filePath = path.join(os.homedir(), '.jackclaw', 'clawchat-auth.json')
    const raw = await fs.readFile(filePath, 'utf8')
    const data = JSON.parse(raw) as { token?: string }
    return data.token ?? ''
  } catch {
    return ''
  }
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

/**
 * jackclaw_mention — @某个 Agent 发起协作
 *
 * 向目标 Agent 发送一条协作请求消息，双方可通过 Hub 建立临时会话。
 */
function buildMentionTool(nodeId: string): OpenClawTool {
  return {
    name: 'jackclaw_mention',
    description:
      '@某个 JackClaw Agent，向其发起协作请求。可附带主题和初始消息。目标 Agent 会收到邀请通知。',
    parameters: {
      type: 'object',
      required: ['targetNodeId', 'topic'],
      properties: {
        targetNodeId: {
          type: 'string',
          description: '目标 Agent 的 nodeId（例如 "agent-pm-01"）',
        },
        topic: {
          type: 'string',
          description: '协作主题的简短描述',
        },
        message: {
          type: 'string',
          description: '（可选）附带的初始消息内容',
        },
      },
    },
    async handler(params) {
      const p = params as { targetNodeId: string; topic: string; message?: string }
      const result = await hubRequest<{ inviteId: string; status: string }>(
        'POST',
        `/api/nodes/${nodeId}/mention`,
        {
          fromNodeId: nodeId,
          targetNodeId: p.targetNodeId,
          topic: p.topic,
          message: p.message ?? '',
          createdAt: Date.now(),
        },
      )
      return {
        success: true,
        inviteId: result.inviteId,
        status: result.status,
        message: `已向 ${p.targetNodeId} 发送协作邀请（主题：${p.topic}）`,
      }
    },
  }
}

/**
 * jackclaw_send_task — 向某个 Node 发送任务
 *
 * 创建一条任务记录并推送给目标节点，目标节点可以 accept/reject/complete。
 */
function buildSendTaskTool(nodeId: string): OpenClawTool {
  return {
    name: 'jackclaw_send_task',
    description:
      '向指定的 JackClaw Node 发送一个具体任务。任务包含标题、描述和可选截止时间。',
    parameters: {
      type: 'object',
      required: ['targetNodeId', 'title'],
      properties: {
        targetNodeId: {
          type: 'string',
          description: '接收任务的 Node ID',
        },
        title: {
          type: 'string',
          description: '任务标题（简短，一句话）',
        },
        description: {
          type: 'string',
          description: '（可选）任务详细说明',
        },
        dueAt: {
          type: 'number',
          description: '（可选）截止时间，Unix 毫秒时间戳',
        },
        priority: {
          type: 'string',
          enum: ['low', 'normal', 'high', 'urgent'],
          description: '（可选）任务优先级，默认 normal',
        },
      },
    },
    async handler(params) {
      const p = params as {
        targetNodeId: string
        title: string
        description?: string
        dueAt?: number
        priority?: string
      }
      const result = await hubRequest<{ taskId: string; status: string }>(
        'POST',
        `/api/tasks`,
        {
          fromNodeId: nodeId,
          targetNodeId: p.targetNodeId,
          title: p.title,
          description: p.description ?? '',
          dueAt: p.dueAt,
          priority: p.priority ?? 'normal',
          createdAt: Date.now(),
        },
      )
      return {
        success: true,
        taskId: result.taskId,
        status: result.status,
        message: `任务「${p.title}」已发送给 ${p.targetNodeId}（ID: ${result.taskId}）`,
      }
    },
  }
}

/**
 * jackclaw_check_trust — 查询对某个 Agent 的信任度
 *
 * 从 Hub 查询本节点对目标节点的信任评分（0-100）及历史交互记录摘要。
 */
function buildCheckTrustTool(nodeId: string): OpenClawTool {
  return {
    name: 'jackclaw_check_trust',
    description:
      '查询本节点对某个 JackClaw Agent 的信任评分（0-100）以及协作历史摘要。用于决定是否接受协作邀请。',
    parameters: {
      type: 'object',
      required: ['targetNodeId'],
      properties: {
        targetNodeId: {
          type: 'string',
          description: '要查询信任度的目标 Node ID',
        },
      },
    },
    async handler(params) {
      const p = params as { targetNodeId: string }
      const result = await hubRequest<{
        score: number
        level: string
        totalCollabs: number
        successRate: number
        lastCollab?: number
      }>('GET', `/api/trust/${nodeId}/${p.targetNodeId}`)

      const lastCollabStr = result.lastCollab
        ? new Date(result.lastCollab).toLocaleDateString('zh-CN')
        : '无记录'

      return {
        targetNodeId: p.targetNodeId,
        score: result.score,
        level: result.level,
        totalCollabs: result.totalCollabs,
        successRate: `${Math.round(result.successRate * 100)}%`,
        lastCollab: lastCollabStr,
        summary: `信任度：${result.score}/100（${result.level}）| 协作 ${result.totalCollabs} 次，成功率 ${Math.round(result.successRate * 100)}%，上次协作：${lastCollabStr}`,
      }
    },
  }
}

/**
 * jackclaw_my_sessions — 查看当前活跃协作
 *
 * 列出本节点当前所有进行中的协作会话（状态：pending/active）。
 */
function buildMySessionsTool(nodeId: string): OpenClawTool {
  return {
    name: 'jackclaw_my_sessions',
    description:
      '查看本节点当前所有活跃的 JackClaw 协作会话，包括对方节点、主题、状态和开始时间。',
    parameters: {
      type: 'object',
      required: [],
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'active', 'all'],
          description: '（可选）过滤状态，默认返回 pending + active',
        },
      },
    },
    async handler(params) {
      const p = params as { status?: string }
      const statusFilter = p.status ?? 'all'
      const qs = statusFilter !== 'all' ? `?status=${statusFilter}` : '?status=pending&status=active'

      const result = await hubRequest<{
        sessions: Array<{
          sessionId: string
          peerNodeId: string
          peerName: string
          topic: string
          status: string
          startedAt: number
          lastActivityAt: number
        }>
      }>('GET', `/api/nodes/${nodeId}/sessions${qs}`)

      const sessions = result.sessions ?? []
      if (sessions.length === 0) {
        return { count: 0, sessions: [], summary: '当前无活跃协作会话。' }
      }

      const lines = sessions.map(
        (s) =>
          `[${s.status}] ${s.peerName}(${s.peerNodeId}) — ${s.topic} ` +
          `（开始：${new Date(s.startedAt).toLocaleString('zh-CN')}）`,
      )

      return {
        count: sessions.length,
        sessions,
        summary: `活跃协作 ${sessions.length} 个：\n${lines.join('\n')}`,
      }
    },
  }
}

/**
 * jackclaw_plan_task — 为开发任务生成结构化执行计划
 *
 * 调用 Hub POST /api/plan/estimate，返回耗时、Token 成本、并行策略的
 * 格式化执行计划。
 */
function buildPlanTaskTool(): OpenClawTool {
  return {
    name: 'jackclaw_plan_task',
    description:
      'Generate execution plan for a development task: estimated time, token cost, parallel strategy',
    parameters: {
      type: 'object',
      required: ['title', 'description'],
      properties: {
        title: {
          type: 'string',
          description: 'Task title',
        },
        description: {
          type: 'string',
          description: 'Task description',
        },
      },
    },
    async handler(params) {
      const p = params as { title: string; description: string }
      const result = await hubRequest<{
        plan: {
          taskId: string
          title: string
          complexity: string
          estimatedMinutesSerial: number
          estimatedMinutesParallel: number
          parallelSpeedup: number
          estimatedTotalTokens: number
          estimatedCostUsd: number
          needsParallel: boolean
          suggestedAgentCount: number
          subtasks: unknown[]
          parallelBatches: unknown[]
          overallRisk: string
          risks: string[]
          plannerVersion: string
          plannedAt: number
        }
        note?: string
      }>('POST', '/api/plan/estimate', {
        title: p.title,
        description: p.description,
      })

      const plan = result.plan
      const lines: string[] = [
        `📋 执行计划：${plan.title}`,
        ``,
        `复杂度：${plan.complexity}  |  风险：${plan.overallRisk}`,
        `预估耗时：串行 ${plan.estimatedMinutesSerial}min / 并行 ${plan.estimatedMinutesParallel}min（加速 ${plan.parallelSpeedup}x）`,
        `Token 消耗：~${plan.estimatedTotalTokens.toLocaleString()} tokens（$${plan.estimatedCostUsd}）`,
        `建议 Agent 数：${plan.suggestedAgentCount}${plan.needsParallel ? '（建议并行）' : ''}`,
      ]
      if (plan.risks.length > 0) {
        lines.push(``, `风险点：`, ...plan.risks.map(r => `  • ${r}`))
      }
      if (result.note) {
        lines.push(``, `注：${result.note}`)
      }
      const formatted = lines.join('\n')

      return { plan: result.plan, formatted }
    },
  }
}

// ─── Chat Tool Definitions ────────────────────────────────────────────────────

/**
 * jackclaw_chat_send — 发送消息给某个用户/Agent
 *
 * 调用 Hub POST /api/chat/send，JWT 优先从 clawchat-auth.json 读取。
 */
function buildChatSendTool(): OpenClawTool {
  return {
    name: 'jackclaw_chat_send',
    description: '发送消息给某个用户或 Agent（通过 @handle 标识）。支持普通消息和任务消息。',
    parameters: {
      type: 'object',
      required: ['to', 'message'],
      properties: {
        to: {
          type: 'string',
          description: '收件人的 @handle（例如 "@alice" 或 "alice"）',
        },
        message: {
          type: 'string',
          description: '消息内容',
        },
        type: {
          type: 'string',
          enum: ['human', 'task'],
          description: '（可选）消息类型：human = 普通消息，task = 任务消息。默认 human',
        },
      },
    },
    async handler(params) {
      const p = params as { to: string; message: string; type?: 'human' | 'task' }
      const jwt = await readChatJwt()
      const result = await hubRequest<{ messageId: string; status: string }>(
        'POST',
        '/api/chat/send',
        {
          to: p.to,
          message: p.message,
          type: p.type ?? 'human',
          sentAt: Date.now(),
        },
        jwt || undefined,
      )
      return {
        success: true,
        messageId: result.messageId,
        status: result.status,
        message: `消息已发送给 ${p.to}（ID: ${result.messageId}）`,
      }
    },
  }
}

/**
 * jackclaw_chat_inbox — 查看收件箱
 *
 * 调用 Hub GET /api/chat/inbox，返回最新收到的消息列表。
 */
function buildChatInboxTool(): OpenClawTool {
  return {
    name: 'jackclaw_chat_inbox',
    description: '查看收件箱中的消息列表，按时间倒序返回最新消息。',
    parameters: {
      type: 'object',
      required: [],
      properties: {
        limit: {
          type: 'number',
          description: '（可选）返回的最大消息数量，默认 20，最大 100',
        },
      },
    },
    async handler(params) {
      const p = params as { limit?: number }
      const jwt = await readChatJwt()
      const qs = p.limit !== undefined ? `?limit=${p.limit}` : ''
      const result = await hubRequest<{
        messages: Array<{
          messageId: string
          from: string
          message: string
          type: string
          receivedAt: number
          read: boolean
        }>
        total: number
      }>('GET', `/api/chat/inbox${qs}`, undefined, jwt || undefined)

      const messages = result.messages ?? []
      if (messages.length === 0) {
        return { count: 0, messages: [], summary: '收件箱为空。' }
      }

      const lines = messages.map(
        (m) =>
          `[${m.read ? '已读' : '未读'}] ${m.from}: ${m.message.slice(0, 60)}${m.message.length > 60 ? '…' : ''} ` +
          `（${new Date(m.receivedAt).toLocaleString('zh-CN')}）`,
      )

      return {
        count: result.total,
        messages,
        summary: `收件箱共 ${result.total} 条消息：\n${lines.join('\n')}`,
      }
    },
  }
}

/**
 * jackclaw_chat_threads — 查看会话列表
 *
 * 调用 Hub GET /api/chat/threads，返回当前用户的所有会话。
 */
function buildChatThreadsTool(): OpenClawTool {
  return {
    name: 'jackclaw_chat_threads',
    description: '查看所有聊天会话（threads）列表，包括对方信息和最后一条消息预览。',
    parameters: {
      type: 'object',
      required: [],
      properties: {},
    },
    async handler(_params) {
      const jwt = await readChatJwt()
      const result = await hubRequest<{
        threads: Array<{
          threadId: string
          peer: string
          peerHandle: string
          lastMessage: string
          lastMessageAt: number
          unreadCount: number
        }>
      }>('GET', '/api/chat/threads', undefined, jwt || undefined)

      const threads = result.threads ?? []
      if (threads.length === 0) {
        return { count: 0, threads: [], summary: '暂无会话记录。' }
      }

      const lines = threads.map(
        (t) =>
          `[${t.unreadCount > 0 ? `${t.unreadCount}条未读` : '已读'}] @${t.peerHandle}: ` +
          `${t.lastMessage.slice(0, 50)}${t.lastMessage.length > 50 ? '…' : ''} ` +
          `（${new Date(t.lastMessageAt).toLocaleString('zh-CN')}）`,
      )

      return {
        count: threads.length,
        threads,
        summary: `共 ${threads.length} 个会话：\n${lines.join('\n')}`,
      }
    },
  }
}

/**
 * jackclaw_chat_search_users — 搜索用户
 *
 * 调用 Hub GET /api/search/contacts?q=...，支持按用户名、handle 模糊搜索。
 */
function buildChatSearchUsersTool(): OpenClawTool {
  return {
    name: 'jackclaw_chat_search_users',
    description: '按关键词搜索 JackClaw 用户（支持用户名、@handle 模糊匹配）。',
    parameters: {
      type: 'object',
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词（用户名或 handle 的部分内容）',
        },
      },
    },
    async handler(params) {
      const p = params as { query: string }
      const jwt = await readChatJwt()
      const q = encodeURIComponent(p.query)
      const result = await hubRequest<{
        users: Array<{
          userId: string
          handle: string
          displayName: string
          online: boolean
          avatarUrl?: string
        }>
        total: number
      }>('GET', `/api/search/contacts?q=${q}`, undefined, jwt || undefined)

      const users = result.users ?? []
      if (users.length === 0) {
        return { count: 0, users: [], summary: `未找到匹配「${p.query}」的用户。` }
      }

      const lines = users.map(
        (u) =>
          `${u.online ? '🟢' : '⚫'} @${u.handle}（${u.displayName}）— ID: ${u.userId}`,
      )

      return {
        count: result.total,
        users,
        summary: `找到 ${result.total} 个用户：\n${lines.join('\n')}`,
      }
    },
  }
}

/**
 * jackclaw_chat_online — 查看在线用户
 *
 * 调用 Hub GET /api/presence/online，返回当前在线的用户列表。
 */
function buildChatOnlineTool(): OpenClawTool {
  return {
    name: 'jackclaw_chat_online',
    description: '查看当前在线的 JackClaw 用户列表（实时 presence 状态）。',
    parameters: {
      type: 'object',
      required: [],
      properties: {},
    },
    async handler(_params) {
      const jwt = await readChatJwt()
      const result = await hubRequest<{
        online: Array<{
          userId: string
          handle: string
          displayName: string
          lastSeenAt: number
          status?: string
        }>
        count: number
      }>('GET', '/api/presence/online', undefined, jwt || undefined)

      const online = result.online ?? []
      if (online.length === 0) {
        return { count: 0, online: [], summary: '当前无在线用户。' }
      }

      const lines = online.map(
        (u) =>
          `🟢 @${u.handle}（${u.displayName}）${u.status ? `— ${u.status}` : ''}`,
      )

      return {
        count: result.count,
        online,
        summary: `当前在线 ${result.count} 人：\n${lines.join('\n')}`,
      }
    },
  }
}

/**
 * jackclaw_chat_group_create — 创建聊天群组
 */
function buildChatGroupCreateTool(nodeId: string): OpenClawTool {
  return {
    name: 'jackclaw_chat_group_create',
    description: '创建一个新的 ClawChat 群组，并将指定成员加入。',
    parameters: {
      type: 'object',
      required: ['name', 'members'],
      properties: {
        name: {
          type: 'string',
          description: '群组名称',
        },
        members: {
          type: 'array',
          items: { type: 'string' },
          description: '成员 handle 列表（例如 ["alice", "bob"]）',
        },
      },
    },
    async handler(params) {
      const p = params as { name: string; members: string[] }
      const jwt = await readChatJwt()
      const result = await hubRequest<{ group: { groupId: string; name: string; members: string[] } }>(
        'POST',
        '/api/chat/group/create',
        { name: p.name, members: p.members, createdBy: nodeId },
        jwt || undefined,
      )
      const g = result.group
      return {
        success: true,
        groupId: g.groupId,
        name: g.name,
        members: g.members,
        summary: `群组「${g.name}」已创建（ID: ${g.groupId}），成员：${g.members.join(', ')}`,
      }
    },
  }
}

/**
 * jackclaw_chat_group_list — 查看我加入的群组
 */
function buildChatGroupListTool(nodeId: string): OpenClawTool {
  return {
    name: 'jackclaw_chat_group_list',
    description: '列出当前节点所属的所有 ClawChat 群组。',
    parameters: {
      type: 'object',
      required: [],
      properties: {},
    },
    async handler(_params) {
      const jwt = await readChatJwt()
      const result = await hubRequest<{
        groups: Array<{
          groupId: string
          name: string
          members: string[]
          createdBy: string
          createdAt: number
        }>
      }>('GET', `/api/chat/groups?nodeId=${encodeURIComponent(nodeId)}`, undefined, jwt || undefined)

      const groups = result.groups ?? []
      if (groups.length === 0) {
        return { count: 0, groups: [], summary: '暂未加入任何群组。' }
      }

      const lines = groups.map(
        (g) => `[${g.groupId}] **${g.name}** — ${g.members.length} 人`,
      )

      return {
        count: groups.length,
        groups,
        summary: `共 ${groups.length} 个群组：\n${lines.join('\n')}`,
      }
    },
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * getJackClawTools — 返回该 Node 支持的所有 JackClaw 工具列表
 *
 * @param nodeId  当前节点的 ID（用于构造 API 请求路径）
 */
export function getJackClawTools(nodeId: string): OpenClawTool[] {
  return [
    buildMentionTool(nodeId),
    buildSendTaskTool(nodeId),
    buildCheckTrustTool(nodeId),
    buildMySessionsTool(nodeId),
    buildPlanTaskTool(),
    buildChatSendTool(),
    buildChatInboxTool(),
    buildChatThreadsTool(),
    buildChatSearchUsersTool(),
    buildChatOnlineTool(),
    buildChatGroupCreateTool(nodeId),
    buildChatGroupListTool(nodeId),
  ]
}
