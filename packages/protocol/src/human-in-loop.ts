// JackClaw Protocol - HumanInLoop 机制
// 核心理念（Messy Jobs 第6章）：利益冲突时 AI 无法强制决策——必须触发真人介入。

import { randomUUID, createHmac } from 'crypto'

// ─── Types ───────────────────────────────────────────────────────────────────

export type HumanInLoopTrigger =
  | 'resource_conflict'  // 多个 Node 争抢同一资源
  | 'trust_threshold'    // 对方信任度低于阈值
  | 'high_stakes'        // 高风险操作（删除/公开发布/付款等）
  | 'bundle_approval'    // 强束任务需审批
  | 'watchdog_alert'     // Watchdog 触发告警
  | 'autonomy_exceeded'  // 操作超出配置的自主度等级
  | 'manual'             // 手动触发

export interface HumanReviewRequest {
  requestId: string
  trigger: HumanInLoopTrigger
  nodeId: string
  description: string
  context: Record<string, unknown>
  options: ReviewOption[]    // 给真人的选项
  deadline?: number          // 超时后默认行为
  defaultOnTimeout: 'approve' | 'reject' | 'defer'
  createdAt: number
  resolvedAt?: number
  resolvedBy?: string        // 真人 ID
  decision?: string          // 真人的决定
}

export interface ReviewOption {
  id: string
  label: string
  consequence: string        // 选择这个会发生什么
  risk: 'low' | 'medium' | 'high'
}

// ─── 高风险操作关键词 ─────────────────────────────────────────────────────────

const HIGH_STAKES_ACTIONS = [
  'delete', 'remove', 'publish', 'deploy', 'payment', 'pay',
  'transfer', 'broadcast', 'announce', 'release', 'drop',
  'terminate', 'shutdown', 'override', 'reset',
]

// L0-L3 自主度等级映射：每个等级允许的操作集合
const AUTONOMY_ALLOWED_ACTIONS: Record<number, string[]> = {
  0: [],                                      // L0：所有操作都需人工
  1: ['read', 'list', 'query', 'ping'],       // L1：只读
  2: ['read', 'list', 'query', 'ping',        // L2：读写，不含高风险
    'write', 'update', 'create', 'report'],
  3: [...HIGH_STAKES_ACTIONS,                 // L3：全部允许
    'read', 'list', 'query', 'ping',
    'write', 'update', 'create', 'report'],
}

// ─── HumanInLoopManager ───────────────────────────────────────────────────────

export class HumanInLoopManager {
  /** 内存中的待处理请求（生产环境应持久化到 DB） */
  private pendingRequests = new Map<string, HumanReviewRequest>()

  /**
   * 可选：节点的自主度等级配置。
   * nodeId → autonomyLevel (0-3)
   */
  private nodeAutonomyLevels = new Map<string, 0 | 1 | 2 | 3>()

  /**
   * 可选：节点间信任度图。
   * `${fromNodeId}:${toNodeId}` → 0.0-1.0
   */
  private trustGraph = new Map<string, number>()

  /** human-token 的 HMAC secret（生产环境从环境变量读取） */
  private humanTokenSecret: string

  constructor(opts?: {
    humanTokenSecret?: string
    nodeAutonomyLevels?: Record<string, 0 | 1 | 2 | 3>
    trustGraph?: Record<string, number>
  }) {
    this.humanTokenSecret = opts?.humanTokenSecret
      ?? process.env.HUMAN_TOKEN_SECRET
      ?? 'change-me-in-production'

    if (opts?.nodeAutonomyLevels) {
      for (const [nodeId, level] of Object.entries(opts.nodeAutonomyLevels)) {
        this.nodeAutonomyLevels.set(nodeId, level)
      }
    }
    if (opts?.trustGraph) {
      for (const [key, score] of Object.entries(opts.trustGraph)) {
        this.trustGraph.set(key, score)
      }
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * 创建审查请求并暂停相关 Agent 操作。
   * 返回 requestId。
   */
  async requestReview(
    req: Omit<HumanReviewRequest, 'requestId' | 'createdAt'>
  ): Promise<string> {
    const requestId = randomUUID()
    const fullReq: HumanReviewRequest = {
      ...req,
      requestId,
      createdAt: Date.now(),
    }
    this.pendingRequests.set(requestId, fullReq)

    // 如果设置了超时，自动处理默认决策
    if (fullReq.deadline) {
      const ttl = fullReq.deadline - Date.now()
      if (ttl > 0) {
        setTimeout(() => {
          const pending = this.pendingRequests.get(requestId)
          if (pending && !pending.resolvedAt) {
            this.applyTimeoutDefault(pending)
          }
        }, ttl)
      }
    }

    return requestId
  }

  /**
   * 真人决策（只能由持有 human-token 的调用者执行）。
   * human-token 格式：HMAC-SHA256(requestId, secret)
   */
  async resolve(
    requestId: string,
    decision: string,
    humanToken: string
  ): Promise<void> {
    const req = this.pendingRequests.get(requestId)
    if (!req) {
      throw new Error(`Review request ${requestId} not found.`)
    }
    if (req.resolvedAt) {
      throw new Error(`Review request ${requestId} already resolved.`)
    }

    // 验证 human-token
    if (!this.verifyHumanToken(requestId, humanToken)) {
      throw new Error('Invalid human-token. Unauthorized.')
    }

    // 验证 decision 是否在选项范围内
    const validOptionIds = req.options.map(o => o.id)
    if (!validOptionIds.includes(decision)) {
      throw new Error(
        `Decision "${decision}" is not a valid option. Valid: ${validOptionIds.join(', ')}`
      )
    }

    req.resolvedAt = Date.now()
    req.decision = decision
    // resolvedBy 由调用者在 context 中提供，或从 token 派生
    req.resolvedBy = req.resolvedBy ?? `human:${humanToken.slice(0, 8)}`
    this.pendingRequests.set(requestId, req)
  }

  /**
   * 查询待处理请求（可按 nodeId 过滤）。
   */
  async getPending(nodeId?: string): Promise<HumanReviewRequest[]> {
    const all = Array.from(this.pendingRequests.values()).filter(r => !r.resolvedAt)
    if (nodeId) {
      return all.filter(r => r.nodeId === nodeId)
    }
    return all
  }

  /**
   * 检查某操作是否需要人工审批（基于 AutonomyLevel + TrustGraph）。
   */
  async shouldRequireHuman(
    action: string,
    nodeId: string,
    targetNodeId?: string
  ): Promise<boolean> {
    const level = this.nodeAutonomyLevels.get(nodeId) ?? 2 // 默认 L2
    const normalizedAction = action.toLowerCase()

    // L0：所有操作都需要人工
    if (level === 0) return true

    // 检查高风险操作
    const isHighStakes = HIGH_STAKES_ACTIONS.some(a => normalizedAction.includes(a))
    if (isHighStakes && level < 3) return true

    // 检查操作是否超出自主度等级
    const allowed = AUTONOMY_ALLOWED_ACTIONS[level] ?? []
    const actionAllowed = allowed.some(a => normalizedAction.includes(a))
    if (!actionAllowed) return true

    // 检查目标节点的信任度
    if (targetNodeId) {
      const trustKey = `${nodeId}:${targetNodeId}`
      const trustScore = this.trustGraph.get(trustKey)
      if (trustScore !== undefined && trustScore < 0.5) {
        return true // 信任度低于阈值
      }
    }

    return false
  }

  // ── 配置 API ────────────────────────────────────────────────────────────────

  setNodeAutonomyLevel(nodeId: string, level: 0 | 1 | 2 | 3): void {
    this.nodeAutonomyLevels.set(nodeId, level)
  }

  setTrust(fromNodeId: string, toNodeId: string, score: number): void {
    this.trustGraph.set(`${fromNodeId}:${toNodeId}`, Math.max(0, Math.min(1, score)))
  }

  /**
   * 生成 human-token（用于测试或管理员颁发）。
   */
  generateHumanToken(requestId: string): string {
    return createHmac('sha256', this.humanTokenSecret)
      .update(requestId)
      .digest('hex')
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private verifyHumanToken(requestId: string, token: string): boolean {
    const expected = this.generateHumanToken(requestId)
    // 常量时间比较，防止时序攻击
    if (expected.length !== token.length) return false
    let diff = 0
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ token.charCodeAt(i)
    }
    return diff === 0
  }

  private applyTimeoutDefault(req: HumanReviewRequest): void {
    req.resolvedAt = Date.now()
    req.resolvedBy = 'system:timeout'

    switch (req.defaultOnTimeout) {
      case 'approve':
        // 选第一个低风险选项，或第一个选项
        req.decision =
          req.options.find(o => o.risk === 'low')?.id ?? req.options[0]?.id ?? 'approve'
        break
      case 'reject':
        req.decision =
          req.options.find(o => o.risk === 'low')?.id ?? req.options[0]?.id ?? 'reject'
        break
      case 'defer':
        req.decision = 'defer'
        break
    }

    this.pendingRequests.set(req.requestId, req)
  }
}

// ── 单例导出（可选，适用于简单场景）──────────────────────────────────────────

export const humanInLoopManager = new HumanInLoopManager()
