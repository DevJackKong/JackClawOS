/**
 * JackClaw Task Planner — 任务规划引擎
 *
 * 收到任何开发任务时，先自动输出执行计划：
 * - 预计耗时
 * - 消耗 token 估算
 * - 是否需要并行（以及如何拆分）
 * - 依赖关系图
 * - 风险评估
 *
 * 规划结果存入 TaskBundle，供 Dispatcher / Hub 直接消费
 */
import type { AiClient } from './ai-client';
export type TaskComplexity = 'trivial' | 'simple' | 'moderate' | 'complex' | 'epic';
export interface SubTask {
    id: string;
    title: string;
    description: string;
    estimatedMinutes: number;
    estimatedTokens: number;
    canParallel: boolean;
    dependsOn: string[];
    assignTo?: string;
    riskLevel: 'low' | 'medium' | 'high';
    riskNote?: string;
}
export interface ExecutionPlan {
    taskId: string;
    title: string;
    complexity: TaskComplexity;
    estimatedMinutesSerial: number;
    estimatedMinutesParallel: number;
    parallelSpeedup: number;
    estimatedTotalTokens: number;
    estimatedCostUsd: number;
    needsParallel: boolean;
    parallelBatches: string[][];
    suggestedAgentCount: number;
    subtasks: SubTask[];
    overallRisk: 'low' | 'medium' | 'high';
    risks: string[];
    plannerVersion: '1.0';
    plannedAt: number;
    planningTokensUsed?: number;
}
export declare class TaskPlanner {
    private aiClient;
    constructor(aiClient: AiClient);
    /**
     * 分析任务，生成执行计划
     * 如果 aiClient 可用，使用 AI 做细化分析；否则用启发式规则
     */
    plan(opts: {
        taskId: string;
        title: string;
        description: string;
        context?: string;
        useAi?: boolean;
    }): Promise<ExecutionPlan>;
    private heuristicPlan;
    private aiRefinePlan;
    private guessComplexity;
    private complexityToMinutes;
    private extractSubtasks;
    private topoSort;
    private detectRisks;
    private estimateCost;
}
export declare function formatPlan(plan: ExecutionPlan): string;
//# sourceMappingURL=task-planner.d.ts.map