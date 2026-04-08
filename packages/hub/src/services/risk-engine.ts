/**
 * Risk Engine / 风控规则引擎
 *
 * Lightweight in-memory risk detection for JackClaw Hub.
 * JackClaw Hub 的轻量级内存风控检测引擎。
 *
 * Features / 特性：
 * - Rule-based evaluation / 基于规则的判定
 * - Built-in short-window behavior analysis / 内置短时间行为分析
 * - Default risk presets / 预置默认风险规则
 * - English + 中文注释 / 中英文注释
 */

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface RiskRule {
  id: string
  name: string
  description: string
  condition: (ctx: RiskContext) => boolean
  level: RiskLevel
  action: 'log' | 'warn' | 'block' | 'require_approval'
}

export interface RiskContext {
  tenantId: string
  actorId: string
  actorType: 'user' | 'agent' | 'system'
  action: string
  targetType?: string
  targetId?: string
  metadata?: Record<string, unknown>
  ip?: string
  timestamp: number
}

export interface RiskResult {
  passed: boolean
  level: RiskLevel
  triggeredRules: Array<{ ruleId: string; ruleName: string; level: RiskLevel; action: string }>
  recommendations: string[]
}

/**
 * Internal activity record / 内部行为记录。
 */
interface ActivityRecord {
  tenantId: string
  actorId: string
  actorType: RiskContext['actorType']
  action: string
  targetType?: string
  targetId?: string
  metadata?: Record<string, unknown>
  ip?: string
  timestamp: number
}

/**
 * Internal precomputed signals for current evaluation.
 * 当前评估时预计算出的风险信号。
 */
interface RiskSignals {
  hasDeleteAction: boolean
  actionCountInMinute: number
  isOffHoursWriteOperation: boolean
  isSelfRoleEscalation: boolean
  isCrossTenantAccess: boolean
}

const SIGNALS_KEY = '__riskSignals'
const DEFAULT_HISTORY_LIMIT = 5000
const ACTION_WINDOW_MS = 60 * 1000

const RISK_LEVEL_PRIORITY: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
}

const ADMIN_ROLES = new Set(['owner', 'admin'])
const WRITE_ACTION_KEYWORDS = ['create', 'update', 'write', 'edit', 'patch', 'put', 'post', 'delete', 'remove', 'grant', 'assign']

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function getSignals(ctx: RiskContext): RiskSignals {
  const metadata = asRecord(ctx.metadata)
  const signals = asRecord(metadata?.[SIGNALS_KEY])

  return {
    hasDeleteAction: asBoolean(signals?.hasDeleteAction) ?? false,
    actionCountInMinute: typeof signals?.actionCountInMinute === 'number' ? signals.actionCountInMinute : 0,
    isOffHoursWriteOperation: asBoolean(signals?.isOffHoursWriteOperation) ?? false,
    isSelfRoleEscalation: asBoolean(signals?.isSelfRoleEscalation) ?? false,
    isCrossTenantAccess: asBoolean(signals?.isCrossTenantAccess) ?? false,
  }
}

function getMetadata(ctx: RiskContext): Record<string, unknown> {
  return asRecord(ctx.metadata) ?? {}
}

function getRecommendationsForRule(rule: RiskRule): string[] {
  switch (rule.id) {
    case 'bulk-delete-detection':
      return [
        'Require manual approval before DELETE action continues.',
        'DELETE 操作继续前要求人工审批。',
      ]
    case 'sensitive-operation-frequency':
      return [
        'Throttle this actor or add temporary rate limits.',
        '对该 actor 进行限流或添加临时频控。',
      ]
    case 'off-hours-write-operation':
      return [
        'Write an audit log and verify whether this write is expected.',
        '写入审计日志并确认该写操作是否符合预期。',
      ]
    case 'self-role-escalation':
      return [
        'Block the request and notify security administrators immediately.',
        '立即拦截请求并通知安全管理员。',
      ]
    case 'cross-tenant-access':
      return [
        'Block cross-tenant access and inspect tenant isolation logic.',
        '阻止跨租户访问并检查租户隔离逻辑。',
      ]
    default:
      return [
        'Review audit logs for this actor and action.',
        '检查该 actor 与动作的审计日志。',
      ]
  }
}

/**
 * Risk engine implementation / 风控引擎实现。
 */
export class RiskEngine {
  private rules: RiskRule[] = []
  private readonly history: ActivityRecord[] = []

  /**
   * Add one rule / 添加规则。
   */
  addRule(rule: RiskRule): void {
    this.removeRule(rule.id)
    this.rules.push(rule)
  }

  /**
   * Remove rule by id / 按 id 删除规则。
   */
  removeRule(id: string): void {
    this.rules = this.rules.filter(rule => rule.id !== id)
  }

  /**
   * List current rules / 列出当前规则。
   */
  listRules(): RiskRule[] {
    return [...this.rules]
  }

  /**
   * Evaluate one action context / 评估一次动作上下文。
   *
   * Notes / 说明：
   * - Signals are computed from recent in-memory history and current request.
   *   风险信号来自近期内存历史 + 当前请求。
   * - The current event is recorded after evaluation.
   *   当前事件会在评估后写入历史。
   */
  evaluate(ctx: RiskContext): RiskResult {
    const enrichedCtx = this.createEnrichedContext(ctx)
    const matchedRules = this.rules.filter(rule => {
      try {
        return rule.condition(enrichedCtx)
      } catch {
        return false
      }
    })

    const triggeredRules = matchedRules.map(rule => ({
      ruleId: rule.id,
      ruleName: rule.name,
      level: rule.level,
      action: rule.action,
    }))

    const level = triggeredRules.reduce<RiskLevel>(
      (current, rule) => (RISK_LEVEL_PRIORITY[rule.level] > RISK_LEVEL_PRIORITY[current] ? rule.level : current),
      'low',
    )

    const passed = !triggeredRules.some(rule => rule.action === 'block')
    const recommendations = Array.from(new Set(matchedRules.flatMap(rule => getRecommendationsForRule(rule))))

    this.recordActivity(ctx)

    return {
      passed,
      level,
      triggeredRules,
      recommendations,
    }
  }

  /**
   * Build enriched context with computed signals.
   * 构建包含预计算风险信号的上下文。
   */
  private createEnrichedContext(ctx: RiskContext): RiskContext {
    const signals = this.computeSignals(ctx)

    return {
      ...ctx,
      metadata: {
        ...getMetadata(ctx),
        [SIGNALS_KEY]: signals,
      },
    }
  }

  /**
   * Compute all built-in signals for current request.
   * 计算当前请求的全部内置风险信号。
   */
  private computeSignals(ctx: RiskContext): RiskSignals {
    const metadata = getMetadata(ctx)
    const now = ctx.timestamp

    const actionCountInMinute = this.history.filter(record => {
      return record.actorId === ctx.actorId && now - record.timestamp <= ACTION_WINDOW_MS
    }).length + 1

    return {
      hasDeleteAction: this.isDeleteAction(ctx.action),
      actionCountInMinute,
      isOffHoursWriteOperation: this.isOffHoursWriteOperation(ctx.action, metadata, now),
      isSelfRoleEscalation: this.isSelfRoleEscalation(ctx),
      isCrossTenantAccess: this.isCrossTenantAccess(ctx),
    }
  }

  /**
   * Persist current activity into local history.
   * 将当前行为写入本地历史。
   */
  private recordActivity(ctx: RiskContext): void {
    this.history.push({
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      actorType: ctx.actorType,
      action: ctx.action,
      targetType: ctx.targetType,
      targetId: ctx.targetId,
      metadata: getMetadata(ctx),
      ip: ctx.ip,
      timestamp: ctx.timestamp,
    })

    if (this.history.length > DEFAULT_HISTORY_LIMIT) {
      this.history.splice(0, this.history.length - DEFAULT_HISTORY_LIMIT)
    }
  }

  /**
   * Whether action contains DELETE semantics.
   * 判断 action 是否包含 DELETE 语义。
   */
  private isDeleteAction(action: string): boolean {
    const normalizedAction = normalizeText(action)
    return normalizedAction.includes('delete')
  }

  /**
   * Whether this action is a write operation.
   * 判断是否属于写操作。
   */
  private isWriteAction(action: string, metadata?: Record<string, unknown>): boolean {
    const normalizedAction = normalizeText(action)
    const method = normalizeText(metadata?.method)
    const category = normalizeText(metadata?.category)

    return WRITE_ACTION_KEYWORDS.some(keyword => normalizedAction.includes(keyword))
      || category === 'write'
      || method === 'post'
      || method === 'put'
      || method === 'patch'
      || method === 'delete'
  }

  /**
   * Detect off-hours write operations.
   * 检测非工作时间写操作。
   */
  private isOffHoursWriteOperation(action: string, metadata: Record<string, unknown>, timestamp: number): boolean {
    const hour = new Date(timestamp).getHours()
    return hour >= 0 && hour < 6 && this.isWriteAction(action, metadata)
  }

  /**
   * Detect self role escalation.
   * 检测自我角色提权。
   */
  private isSelfRoleEscalation(ctx: RiskContext): boolean {
    const metadata = getMetadata(ctx)
    const role = normalizeText(metadata.role ?? metadata.targetRole ?? metadata.newRole)
    const actorId = normalizeText(ctx.actorId)
    const targetId = normalizeText(ctx.targetId)

    return ADMIN_ROLES.has(role) && !!actorId && actorId === targetId
  }

  /**
   * Detect cross-tenant access.
   * 检测跨租户访问。
   */
  private isCrossTenantAccess(ctx: RiskContext): boolean {
    const metadata = getMetadata(ctx)
    const targetTenantId = normalizeText(metadata.targetTenantId)

    return !!targetTenantId && targetTenantId !== normalizeText(ctx.tenantId)
  }
}

/**
 * Register all default risk rules.
 * 初始化全部默认风控规则。
 */
export function initDefaultRules(engine: RiskEngine = riskEngine): RiskEngine {
  engine.addRule({
    id: 'bulk-delete-detection',
    name: 'Delete Action Detection / 删除操作检测',
    description: 'Require approval when action contains DELETE. / 当 action 包含 DELETE 时要求审批。',
    level: 'high',
    action: 'require_approval',
    condition: (ctx) => getSignals(ctx).hasDeleteAction,
  })

  engine.addRule({
    id: 'sensitive-operation-frequency',
    name: 'Sensitive Operation Frequency / 敏感操作频率',
    description: 'Warn when the same actor performs more than 20 actions within 1 minute. / 当同一 actor 在 1 分钟内操作超过 20 次时告警。',
    level: 'medium',
    action: 'warn',
    condition: (ctx) => getSignals(ctx).actionCountInMinute > 20,
  })

  engine.addRule({
    id: 'off-hours-write-operation',
    name: 'Off-hours Write Operation / 非工作时间写操作',
    description: 'Log write operations between 00:00 and 06:00. / 记录 00:00-06:00 的写操作。',
    level: 'medium',
    action: 'log',
    condition: (ctx) => getSignals(ctx).isOffHoursWriteOperation,
  })

  engine.addRule({
    id: 'self-role-escalation',
    name: 'Self Role Escalation / 角色自我提权',
    description: 'Block attempts to grant owner/admin role to self. / 阻止给自己授予 owner/admin 角色的行为。',
    level: 'critical',
    action: 'block',
    condition: (ctx) => getSignals(ctx).isSelfRoleEscalation,
  })

  engine.addRule({
    id: 'cross-tenant-access',
    name: 'Cross-tenant Access / 跨租户访问',
    description: 'Block access when targetTenantId does not match tenantId. / 当 targetTenantId 与 tenantId 不一致时阻止访问。',
    level: 'critical',
    action: 'block',
    condition: (ctx) => getSignals(ctx).isCrossTenantAccess,
  })

  return engine
}

/**
 * Shared singleton instance / 共享单例。
 */
export const riskEngine = new RiskEngine()

initDefaultRules(riskEngine)
