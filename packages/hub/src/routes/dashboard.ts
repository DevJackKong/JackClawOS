import { Router, Request, Response } from 'express'
import { asyncHandler } from '../server'
import { getAllNodes } from '../store/nodes'

const router = Router()

type DashboardOverview = {
  totalNodes: number
  onlineNodes: number
  totalMessages: number
  totalTasks: number
  pendingApprovals: number
  totalContacts: number
  recentActivity: Array<Record<string, unknown>>
}

type GenericRecord = Record<string, any>

type TaskStoreLike = {
  list?: (...args: any[]) => any
}

type ApprovalStoreLike = {
  list?: (...args: any[]) => any
}

type ContactStoreLike = {
  list?: (...args: any[]) => any
}

/**
 * Safe getter wrapper.
 * 安全读取包装：任意 store 不存在、方法不存在或抛错时，返回兜底值。
 */
async function safeGet<T>(getter: () => Promise<T> | T, fallback: T): Promise<T> {
  try {
    return await getter()
  } catch {
    return fallback
  }
}

/**
 * Best-effort import for taskStateStore.
 * 尝试导入 taskStateStore；失败时返回 null。
 */
async function getTaskStateStore(): Promise<TaskStoreLike | null> {
  try {
    const mod = await import('../store/task-state-store')
    return (mod as GenericRecord).taskStateStore ?? null
  } catch {
    return null
  }
}

/**
 * Best-effort import for approvalStore.
 * 尝试导入 approvalStore；失败时返回 null。
 */
async function getApprovalStore(): Promise<ApprovalStoreLike | null> {
  try {
    const mod = await import('../store/approval-store')
    return (mod as GenericRecord).approvalStore ?? null
  } catch {
    return null
  }
}

/**
 * Best-effort import for contactStore.
 * 尝试导入 contactStore；失败时返回 null。
 */
async function getContactStore(): Promise<ContactStoreLike | null> {
  try {
    const mod = await import('../store/contact-store')
    return (mod as GenericRecord).contactStore ?? null
  } catch {
    return null
  }
}

/**
 * Read total tasks from task store.
 * 从任务 store 读取总任务数；若无法读取则降级为 0。
 */
async function getTotalTasks(): Promise<number> {
  return safeGet(async () => {
    const store = await getTaskStateStore()
    if (!store || typeof store.list !== 'function') return 0

    const tasks = await store.list('')
    return Array.isArray(tasks) ? tasks.length : 0
  }, 0)
}

/**
 * Read pending approvals from approval store.
 * 从审批 store 读取待审批数；若无法读取则降级为 0。
 */
async function getPendingApprovals(): Promise<number> {
  return safeGet(async () => {
    const store = await getApprovalStore()
    if (!store || typeof store.list !== 'function') return 0

    const approvals = await store.list('', { state: 'pending' })
    return Array.isArray(approvals) ? approvals.length : 0
  }, 0)
}

/**
 * Read total contacts from contact store.
 * 从联系人 store 读取总联系人数；若无法读取则降级为 0。
 */
async function getTotalContacts(): Promise<number> {
  return safeGet(async () => {
    const store = await getContactStore()
    if (!store || typeof store.list !== 'function') return 0

    const contacts = await store.list('')
    return Array.isArray(contacts) ? contacts.length : 0
  }, 0)
}

/**
 * GET /api/dashboard/overview
 * Dashboard overview metrics.
 * Dashboard 概览统计。
 */
router.get('/overview', asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  const nodes = await safeGet(() => getAllNodes(), [])

  // onlineNodes 暂按最近有心跳/上报时间的节点估算；若字段不存在则回退为 0。
  const onlineNodes = nodes.filter((node: GenericRecord) => {
    const lastSeen = node.lastReportAt ?? node.lastHeartbeatAt ?? node.updatedAt
    return typeof lastSeen === 'number' && lastSeen > 0
  }).length

  const overview: DashboardOverview = {
    totalNodes: nodes.length,
    onlineNodes,
    totalMessages: 0,
    totalTasks: await getTotalTasks(),
    pendingApprovals: await getPendingApprovals(),
    totalContacts: await getTotalContacts(),
    recentActivity: [],
  }

  res.json(overview)
}))

/**
 * GET /api/dashboard/timeline
 * Timeline data.
 * 时间线数据；当前返回空数组。
 */
router.get('/timeline', asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  res.json([])
}))

export default router
