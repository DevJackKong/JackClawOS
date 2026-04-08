/**
 * Reflexion — MIT-style Self-Reflection Engine
 *
 * 任务完成后自动评估：哪里做得好、哪里做得差、下次怎么改。
 * 反思结果写入记忆，下次类似任务自动注入 prompt。
 * 连续失败时累积反思形成改进策略。
 */
export interface ReflexionEntry {
    id: string;
    taskId: string;
    taskDescription: string;
    success: boolean;
    /** 质量评分 0-100 */
    score: number;
    whatWorked: string[];
    whatFailed: string[];
    lessonsLearned: string[];
    improvementPlan: string;
    /** 使用的技能 ID 列表 */
    skillsUsed: string[];
    /** 耗时 ms */
    duration: number;
    /** token 消耗 */
    tokenUsage: {
        input: number;
        output: number;
    };
    timestamp: number;
    /** 反思链：连续失败时引用前一次反思 */
    previousReflexionId?: string;
}
export interface ReflexionContext {
    /** 注入到 prompt 的反思摘要 */
    summary: string;
    /** 相关的历史反思 */
    entries: ReflexionEntry[];
    /** 累积的改进策略（连续失败时） */
    chainedStrategy?: string;
}
export interface TaskOutcome {
    taskId: string;
    taskDescription: string;
    taskResult: string;
    success: boolean;
    duration: number;
    tokenUsage: {
        input: number;
        output: number;
    };
    skillsUsed?: string[];
}
interface LLMClient {
    chat(messages: Array<{
        role: string;
        content: string;
    }>, opts?: {
        temperature?: number;
    }): Promise<string>;
}
export declare class Reflexion {
    private nodeId;
    private llm?;
    private entries;
    private storePath;
    private maxEntries;
    constructor(nodeId: string, llm?: LLMClient | undefined);
    reflect(outcome: TaskOutcome): Promise<ReflexionEntry>;
    getReflexionContext(taskDescription: string, limit?: number): ReflexionContext;
    getAll(): ReflexionEntry[];
    getRecent(limit?: number): ReflexionEntry[];
    getByTaskId(taskId: string): ReflexionEntry | undefined;
    getStats(): {
        totalReflections: number;
        avgScore: number;
        successRate: number;
        topLessons: string[];
    };
    private findRelevant;
    private getRecentFailures;
    private fallbackReflection;
    private trimOldEntries;
    private save;
    private load;
}
export {};
//# sourceMappingURL=reflexion.d.ts.map