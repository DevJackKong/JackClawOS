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
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export interface RiskRule {
    id: string;
    name: string;
    description: string;
    condition: (ctx: RiskContext) => boolean;
    level: RiskLevel;
    action: 'log' | 'warn' | 'block' | 'require_approval';
}
export interface RiskContext {
    tenantId: string;
    actorId: string;
    actorType: 'user' | 'agent' | 'system';
    action: string;
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
    ip?: string;
    timestamp: number;
}
export interface RiskResult {
    passed: boolean;
    level: RiskLevel;
    triggeredRules: Array<{
        ruleId: string;
        ruleName: string;
        level: RiskLevel;
        action: string;
    }>;
    recommendations: string[];
}
/**
 * Risk engine implementation / 风控引擎实现。
 */
export declare class RiskEngine {
    private rules;
    private readonly history;
    /**
     * Add one rule / 添加规则。
     */
    addRule(rule: RiskRule): void;
    /**
     * Remove rule by id / 按 id 删除规则。
     */
    removeRule(id: string): void;
    /**
     * List current rules / 列出当前规则。
     */
    listRules(): RiskRule[];
    /**
     * Evaluate one action context / 评估一次动作上下文。
     *
     * Notes / 说明：
     * - Signals are computed from recent in-memory history and current request.
     *   风险信号来自近期内存历史 + 当前请求。
     * - The current event is recorded after evaluation.
     *   当前事件会在评估后写入历史。
     */
    evaluate(ctx: RiskContext): RiskResult;
    /**
     * Build enriched context with computed signals.
     * 构建包含预计算风险信号的上下文。
     */
    private createEnrichedContext;
    /**
     * Compute all built-in signals for current request.
     * 计算当前请求的全部内置风险信号。
     */
    private computeSignals;
    /**
     * Persist current activity into local history.
     * 将当前行为写入本地历史。
     */
    private recordActivity;
    /**
     * Whether action contains DELETE semantics.
     * 判断 action 是否包含 DELETE 语义。
     */
    private isDeleteAction;
    /**
     * Whether this action is a write operation.
     * 判断是否属于写操作。
     */
    private isWriteAction;
    /**
     * Detect off-hours write operations.
     * 检测非工作时间写操作。
     */
    private isOffHoursWriteOperation;
    /**
     * Detect self role escalation.
     * 检测自我角色提权。
     */
    private isSelfRoleEscalation;
    /**
     * Detect cross-tenant access.
     * 检测跨租户访问。
     */
    private isCrossTenantAccess;
}
/**
 * Register all default risk rules.
 * 初始化全部默认风控规则。
 */
export declare function initDefaultRules(engine?: RiskEngine): RiskEngine;
/**
 * Shared singleton instance / 共享单例。
 */
export declare const riskEngine: RiskEngine;
//# sourceMappingURL=risk-engine.d.ts.map