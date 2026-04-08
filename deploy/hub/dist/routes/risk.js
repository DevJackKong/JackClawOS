"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const risk_engine_1 = require("../services/risk-engine");
const server_1 = require("../server");
const router = (0, express_1.Router)();
/**
 * Ensure required string field exists.
 * 确保必填字符串字段存在。
 */
function requireString(value, fieldName) {
    if (typeof value !== 'string' || !value.trim()) {
        const error = new Error(`${fieldName} is required / ${fieldName} 为必填字段`);
        error.status = 400;
        throw error;
    }
    return value.trim();
}
/**
 * Build condition function from string expression.
 * 通过字符串表达式构建 condition 函数。
 *
 * Example / 示例:
 * - "ctx.action.includes('delete')"
 * - "ctx.actorType === 'agent' && ctx.targetType === 'payment'"
 */
function buildCondition(conditionExpr) {
    try {
        const factory = new Function('ctx', `return (${conditionExpr})`);
        return (ctx) => {
            try {
                return Boolean(factory(ctx));
            }
            catch {
                return false;
            }
        };
    }
    catch {
        const error = new Error('Invalid conditionExpr / conditionExpr 非法');
        error.status = 400;
        throw error;
    }
}
/**
 * POST /api/risk/evaluate
 * Evaluate risk based on request body.
 * 基于请求体进行风险评估。
 */
router.post('/evaluate', (0, server_1.asyncHandler)(async (req, res) => {
    const context = req.body;
    const result = risk_engine_1.riskEngine.evaluate(context);
    res.json({ success: true, result });
}));
/**
 * GET /api/risk/rules
 * List current rules without exposing condition functions.
 * 列出当前规则，但不暴露 condition 函数。
 */
router.get('/rules', (0, server_1.asyncHandler)(async (_req, res) => {
    const rules = risk_engine_1.riskEngine.listRules().map(rule => ({
        id: rule.id,
        name: rule.name,
        description: rule.description,
        level: rule.level,
        action: rule.action,
    }));
    res.json({ success: true, rules, count: rules.length });
}));
/**
 * POST /api/risk/rules
 * Add one custom risk rule.
 * 添加一条自定义风控规则。
 */
router.post('/rules', (0, server_1.asyncHandler)(async (req, res) => {
    const body = (req.body ?? {});
    const id = requireString(body.id, 'id');
    const name = requireString(body.name, 'name');
    const description = requireString(body.description, 'description');
    const level = requireString(body.level, 'level');
    const action = requireString(body.action, 'action');
    const conditionExpr = requireString(body.conditionExpr, 'conditionExpr');
    const rule = {
        id,
        name,
        description,
        level,
        action,
        condition: buildCondition(conditionExpr),
    };
    risk_engine_1.riskEngine.addRule(rule);
    res.status(201).json({
        success: true,
        rule: {
            id,
            name,
            description,
            level,
            action,
        },
    });
}));
/**
 * DELETE /api/risk/rules/:id
 * Remove one rule by id.
 * 按 id 删除一条规则。
 */
router.delete('/rules/:id', (0, server_1.asyncHandler)(async (req, res) => {
    const id = requireString(req.params.id, 'id');
    risk_engine_1.riskEngine.removeRule(id);
    res.json({ success: true, id });
}));
exports.default = router;
//# sourceMappingURL=risk.js.map