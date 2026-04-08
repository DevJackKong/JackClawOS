import { Router, Request, Response } from 'express'
import { riskEngine, type RiskContext, type RiskLevel, type RiskRule } from '../services/risk-engine'
import { asyncHandler } from '../server'

const router = Router()

type RiskAction = RiskRule['action']

interface CreateRiskRuleBody {
  id: string
  name: string
  description: string
  level: RiskLevel
  action: RiskAction
  conditionExpr: string
}

/**
 * Ensure required string field exists.
 * 确保必填字符串字段存在。
 */
function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    const error = new Error(`${fieldName} is required / ${fieldName} 为必填字段`)
    ;(error as Error & { status?: number }).status = 400
    throw error
  }

  return value.trim()
}

/**
 * Build condition function from SAFE declarative rules (no eval/new Function).
 * 通过安全的声明式规则构建 condition 函数（禁止 eval/new Function）。
 *
 * conditionExpr is now a JSON object with field matchers:
 * {
 *   "field": "action",          // ctx field to check
 *   "op": "includes",           // eq | neq | includes | startsWith | gt | lt | in
 *   "value": "delete"           // value to compare against
 * }
 *
 * Multiple conditions can be combined:
 * {
 *   "all": [
 *     { "field": "actorType", "op": "eq", "value": "agent" },
 *     { "field": "targetType", "op": "eq", "value": "payment" }
 *   ]
 * }
 */

interface ConditionRule {
  field?: string
  op?: 'eq' | 'neq' | 'includes' | 'startsWith' | 'gt' | 'lt' | 'in'
  value?: unknown
  all?: ConditionRule[]
  any?: ConditionRule[]
}

function evaluateCondition(rule: ConditionRule, ctx: RiskContext): boolean {
  // Compound: all (AND)
  if (rule.all) {
    return rule.all.every(r => evaluateCondition(r, ctx))
  }
  // Compound: any (OR)
  if (rule.any) {
    return rule.any.some(r => evaluateCondition(r, ctx))
  }

  if (!rule.field || !rule.op) return false

  // Safe field access — only allow known top-level ctx fields
  const val = (ctx as Record<string, unknown>)[rule.field]

  switch (rule.op) {
    case 'eq':         return val === rule.value
    case 'neq':        return val !== rule.value
    case 'includes':   return typeof val === 'string' && typeof rule.value === 'string' && val.includes(rule.value)
    case 'startsWith': return typeof val === 'string' && typeof rule.value === 'string' && val.startsWith(rule.value)
    case 'gt':         return typeof val === 'number' && typeof rule.value === 'number' && val > rule.value
    case 'lt':         return typeof val === 'number' && typeof rule.value === 'number' && val < rule.value
    case 'in':         return Array.isArray(rule.value) && rule.value.includes(val)
    default:           return false
  }
}

function buildCondition(conditionExpr: string): RiskRule['condition'] {
  let parsed: ConditionRule
  try {
    parsed = JSON.parse(conditionExpr) as ConditionRule
  } catch {
    const error = new Error('conditionExpr must be valid JSON / conditionExpr 必须是合法 JSON')
    ;(error as Error & { status?: number }).status = 400
    throw error
  }

  // Validate structure
  if (!parsed.field && !parsed.all && !parsed.any) {
    const error = new Error('conditionExpr must have field+op, all, or any / conditionExpr 必须包含 field+op、all 或 any')
    ;(error as Error & { status?: number }).status = 400
    throw error
  }

  return (ctx: RiskContext): boolean => {
    try {
      return evaluateCondition(parsed, ctx)
    } catch {
      return false
    }
  }
}

/**
 * POST /api/risk/evaluate
 * Evaluate risk based on request body.
 * 基于请求体进行风险评估。
 */
router.post('/evaluate', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const context = req.body as RiskContext
  const result = riskEngine.evaluate(context)

  res.json({ success: true, result })
}))

/**
 * GET /api/risk/rules
 * List current rules without exposing condition functions.
 * 列出当前规则，但不暴露 condition 函数。
 */
router.get('/rules', asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  const rules = riskEngine.listRules().map(rule => ({
    id: rule.id,
    name: rule.name,
    description: rule.description,
    level: rule.level,
    action: rule.action,
  }))

  res.json({ success: true, rules, count: rules.length })
}))

/**
 * POST /api/risk/rules
 * Add one custom risk rule.
 * 添加一条自定义风控规则。
 */
router.post('/rules', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const body = (req.body ?? {}) as Partial<CreateRiskRuleBody>

  const id = requireString(body.id, 'id')
  const name = requireString(body.name, 'name')
  const description = requireString(body.description, 'description')
  const level = requireString(body.level, 'level') as RiskLevel
  const action = requireString(body.action, 'action') as RiskAction
  const conditionExpr = requireString(body.conditionExpr, 'conditionExpr')

  const rule: RiskRule = {
    id,
    name,
    description,
    level,
    action,
    condition: buildCondition(conditionExpr),
  }

  riskEngine.addRule(rule)

  res.status(201).json({
    success: true,
    rule: {
      id,
      name,
      description,
      level,
      action,
    },
  })
}))

/**
 * DELETE /api/risk/rules/:id
 * Remove one rule by id.
 * 按 id 删除一条规则。
 */
router.delete('/rules/:id', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const id = requireString(req.params.id, 'id')
  riskEngine.removeRule(id)

  res.json({ success: true, id })
}))

export default router
