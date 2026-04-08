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
 * Build condition function from string expression.
 * 通过字符串表达式构建 condition 函数。
 *
 * Example / 示例:
 * - "ctx.action.includes('delete')"
 * - "ctx.actorType === 'agent' && ctx.targetType === 'payment'"
 */
function buildCondition(conditionExpr: string): RiskRule['condition'] {
  try {
    const factory = new Function('ctx', `return (${conditionExpr})`) as (ctx: RiskContext) => boolean

    return (ctx: RiskContext): boolean => {
      try {
        return Boolean(factory(ctx))
      } catch {
        return false
      }
    }
  } catch {
    const error = new Error('Invalid conditionExpr / conditionExpr 非法')
    ;(error as Error & { status?: number }).status = 400
    throw error
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
