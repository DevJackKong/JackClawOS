"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const risk_engine_1 = require("../services/risk-engine");
const server_1 = require("../server");
const rbac_helpers_1 = require("./rbac-helpers");
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
function evaluateCondition(rule, ctx) {
    // Compound: all (AND)
    if (rule.all) {
        return rule.all.every(r => evaluateCondition(r, ctx));
    }
    // Compound: any (OR)
    if (rule.any) {
        return rule.any.some(r => evaluateCondition(r, ctx));
    }
    if (!rule.field || !rule.op)
        return false;
    // Safe field access — only allow known top-level ctx fields
    const val = ctx[rule.field];
    switch (rule.op) {
        case 'eq': return val === rule.value;
        case 'neq': return val !== rule.value;
        case 'includes': return typeof val === 'string' && typeof rule.value === 'string' && val.includes(rule.value);
        case 'startsWith': return typeof val === 'string' && typeof rule.value === 'string' && val.startsWith(rule.value);
        case 'gt': return typeof val === 'number' && typeof rule.value === 'number' && val > rule.value;
        case 'lt': return typeof val === 'number' && typeof rule.value === 'number' && val < rule.value;
        case 'in': return Array.isArray(rule.value) && rule.value.includes(val);
        default: return false;
    }
}
function buildCondition(conditionExpr) {
    let parsed;
    try {
        parsed = JSON.parse(conditionExpr);
    }
    catch {
        const error = new Error('conditionExpr must be valid JSON / conditionExpr 必须是合法 JSON');
        error.status = 400;
        throw error;
    }
    // Validate structure
    if (!parsed.field && !parsed.all && !parsed.any) {
        const error = new Error('conditionExpr must have field+op, all, or any / conditionExpr 必须包含 field+op、all 或 any');
        error.status = 400;
        throw error;
    }
    return (ctx) => {
        try {
            return evaluateCondition(parsed, ctx);
        }
        catch {
            return false;
        }
    };
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
    // SECURITY: only admin can create risk rules
    if (!(0, rbac_helpers_1.requireAdmin)(req, res))
        return;
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
    // SECURITY: only admin can delete risk rules
    if (!(0, rbac_helpers_1.requireAdmin)(req, res))
        return;
    // SECURITY: only admin can delete risk rules
    if (!(0, rbac_helpers_1.requireAdmin)(req, res))
        return;
    const id = requireString(req.params.id, 'id');
    risk_engine_1.riskEngine.removeRule(id);
    res.json({ success: true, id });
}));
exports.default = router;
//# sourceMappingURL=risk.js.map