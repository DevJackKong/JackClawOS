import { randomUUID } from 'crypto'
import { Request, Response, Router } from 'express'
import { AgentProfileManager, type AgentProfile } from '../router/agent-profile'
import { MetricsCollector } from '../metrics/task-metrics'
import { SkillLibrary } from '../skill-library'

type ApiResponse = {
  ok: boolean
  data?: unknown
  error?: string
  timestamp: number
}

type TaskStatus = 'pending' | 'running' | 'done' | 'failed'

type ApiTask = {
  taskId: string
  title: string
  description: string
  status: TaskStatus
  createdAt: number
  updatedAt: number
  agentId?: string
  input?: Record<string, unknown>
  result?: unknown
  error?: string
}

type SkillInvokeBody = {
  input?: Record<string, unknown>
  feedback?: string
  success?: boolean
}

const tasks = new Map<string, ApiTask>()
const agentProfiles = new AgentProfileManager()
const metrics = new MetricsCollector()
const skillLibrary = new SkillLibrary(process.env.JACKCLAW_API_NODE_ID ?? 'api-v1')
const seededAgentIds = new Set<string>()

function send(res: Response, status: number, payload: ApiResponse): void {
  res.status(status).json(payload)
}

function ok(res: Response, data: unknown, status = 200): void {
  send(res, status, { ok: true, data, timestamp: Date.now() })
}

function fail(res: Response, status: number, error: string): void {
  send(res, status, { ok: false, error, timestamp: Date.now() })
}

function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

function ensureSeedAgents(): void {
  if (seededAgentIds.size > 0) return

  const now = Date.now()
  const defaults: Array<{ agentId: string; taskType: string; success: boolean; latencyMs: number }> = [
    { agentId: 'planner', taskType: 'planning', success: true, latencyMs: 120 },
    { agentId: 'worker', taskType: 'execution', success: true, latencyMs: 240 },
    { agentId: 'skill-runner', taskType: 'skill', success: true, latencyMs: 180 },
  ]

  for (const item of defaults) {
    agentProfiles.recordTaskResult(item.agentId, {
      taskType: item.taskType,
      success: item.success,
      latencyMs: item.latencyMs,
      toolErrors: {},
    })
    seededAgentIds.add(item.agentId)
  }

  for (const agent of agentProfiles.listAgents()) {
    if (agent.lastActive === 0) {
      agent.lastActive = now
    }
  }
}

function listAgentsWithHealth(): Array<AgentProfile & { health: 'healthy' | 'degraded' | 'idle' }> {
  ensureSeedAgents()

  return agentProfiles.listAgents().map(agent => {
    const ageMs = Date.now() - agent.lastActive
    const health: 'healthy' | 'degraded' | 'idle' = agent.metrics.totalTasks === 0
      ? 'idle'
      : agent.metrics.successRate >= 0.8 && ageMs < 1000 * 60 * 60 * 24
        ? 'healthy'
        : 'degraded'

    return {
      ...agent,
      health,
    }
  })
}

function selectAgentId(): string {
  const agents = listAgentsWithHealth()
  return agents[0]?.agentId ?? 'worker'
}

function taskToMetrics(task: ApiTask): void {
  metrics.record({
    task_id: task.taskId,
    success: task.status === 'done',
    user_satisfied: task.status === 'done',
    tool_errors: task.status === 'failed' ? 1 : 0,
    retry_count: 0,
    latency_sec: Math.max((task.updatedAt - task.createdAt) / 1000, 0),
    memory_hit: task.agentId ? [task.agentId] : [],
  })
}

function maybeAutoCompleteTask(task: ApiTask): ApiTask {
  if (task.status !== 'pending' && task.status !== 'running') return task

  const elapsed = Date.now() - task.createdAt
  if (elapsed > 250) {
    task.status = 'done'
    task.updatedAt = Date.now()
    task.result = {
      message: 'Task completed by in-memory simulator',
      echo: {
        title: task.title,
        description: task.description,
        input: task.input ?? null,
      },
    }
    tasks.set(task.taskId, task)
    taskToMetrics(task)
  } else if (task.status === 'pending' && elapsed > 50) {
    task.status = 'running'
    task.updatedAt = Date.now()
    tasks.set(task.taskId, task)
  }

  return task
}

export function createApiV1Router(): Router {
  const router = Router()

  router.post('/tasks', (req: Request, res: Response) => {
    const { title, description, input } = (req.body ?? {}) as {
      title?: string
      description?: string
      input?: Record<string, unknown>
    }

    if (!title || !description) {
      fail(res, 400, 'title and description are required')
      return
    }

    const now = Date.now()
    const taskId = randomUUID()
    const agentId = selectAgentId()
    const task: ApiTask = {
      taskId,
      title,
      description,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      agentId,
      input,
    }

    tasks.set(taskId, task)
    agentProfiles.recordTaskResult(agentId, {
      taskType: 'task_submission',
      success: true,
      latencyMs: 1,
      toolErrors: {},
    })

    ok(res, task, 201)
  })

  router.get('/tasks/:taskId', (req: Request, res: Response) => {
    const task = tasks.get(req.params.taskId)
    if (!task) {
      fail(res, 404, 'task not found')
      return
    }

    ok(res, maybeAutoCompleteTask(task))
  })

  router.get('/tasks', (req: Request, res: Response) => {
    const status = req.query.status as TaskStatus | undefined
    const limit = toPositiveInt(req.query.limit, 20)
    const allowedStatuses: TaskStatus[] = ['pending', 'running', 'done', 'failed']

    if (status && !allowedStatuses.includes(status)) {
      fail(res, 400, 'status must be one of pending|running|done|failed')
      return
    }

    const items = Array.from(tasks.values())
      .map(maybeAutoCompleteTask)
      .filter(task => (status ? task.status === status : true))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)

    ok(res, {
      items,
      total: items.length,
      filter: { status: status ?? null, limit },
    })
  })

  router.get('/agents', (_req: Request, res: Response) => {
    const agents = listAgentsWithHealth()
    ok(res, {
      items: agents,
      total: agents.length,
    })
  })

  router.get('/skills', (_req: Request, res: Response) => {
    const skills = skillLibrary.getAll()
    ok(res, {
      items: skills,
      total: skills.length,
      stats: skillLibrary.getStats(),
    })
  })

  router.get('/metrics', (_req: Request, res: Response) => {
    const taskStats = metrics.getStats()
    const tasksByStatus = Array.from(tasks.values()).reduce<Record<TaskStatus, number>>((acc, task) => {
      const current = maybeAutoCompleteTask(task)
      acc[current.status] += 1
      return acc
    }, { pending: 0, running: 0, done: 0, failed: 0 })

    ok(res, {
      tasks: {
        total: tasks.size,
        byStatus: tasksByStatus,
      },
      agents: {
        total: listAgentsWithHealth().length,
      },
      skills: skillLibrary.getStats(),
      metrics: taskStats,
    })
  })

  router.post('/skills/:skillId/invoke', (req: Request, res: Response) => {
    const skillId = req.params.skillId
    const body = (req.body ?? {}) as SkillInvokeBody
    const skill = skillLibrary.getById(skillId)

    if (!skill) {
      fail(res, 404, 'skill not found')
      return
    }

    const usedSkill = skillLibrary.useSkill(skillId)
    if (!usedSkill) {
      fail(res, 500, 'failed to load skill')
      return
    }

    if (typeof body.success === 'boolean' || body.feedback) {
      skillLibrary.feedbackSkill(skillId, body.success ?? true, body.feedback)
    }

    agentProfiles.recordTaskResult('skill-runner', {
      taskType: usedSkill.name,
      success: body.success ?? true,
      latencyMs: 5,
      toolErrors: {},
    })

    ok(res, {
      skillId: usedSkill.id,
      name: usedSkill.name,
      description: usedSkill.description,
      input: body.input ?? {},
      output: {
        invoked: true,
        message: `Skill ${usedSkill.name} invoked via REST API`,
        procedure: usedSkill.code,
      },
      usageCount: usedSkill.usageCount,
      successRate: usedSkill.successRate,
    })
  })

  return router
}
