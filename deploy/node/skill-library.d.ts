/**
 * SkillLibrary — Voyager-style Skill Accumulation
 *
 * Agent 完成任务后自动提取可复用技能，存入技能库。
 * 下次遇到类似任务，先查技能库，直接复用已学会的能力。
 * 技能越用越强——根据反馈自动优化。
 */
export interface Skill {
    id: string;
    name: string;
    description: string;
    /** 可复用的函数体 / prompt 模板 / 工作流步骤 */
    code: string;
    /** 输入参数描述 */
    inputSchema: Record<string, string>;
    /** 输出描述 */
    outputSchema: Record<string, string>;
    tags: string[];
    /** 成功率 0-1 */
    successRate: number;
    usageCount: number;
    /** 最近一次使用的反馈 */
    lastFeedback?: string;
    createdAt: number;
    updatedAt: number;
    /** 来源：self=自己学的, shared=别人共享的 */
    origin: 'self' | 'shared';
    originNodeId?: string;
}
export interface SkillExtractionResult {
    extracted: boolean;
    skill?: Skill;
    reason: string;
}
export interface SkillMatch {
    skill: Skill;
    relevance: number;
}
interface LLMClient {
    chat(messages: Array<{
        role: string;
        content: string;
    }>, opts?: {
        model?: string;
        temperature?: number;
    }): Promise<string>;
}
export declare class SkillLibrary {
    private nodeId;
    private llm?;
    private skills;
    private storePath;
    constructor(nodeId: string, llm?: LLMClient | undefined);
    extractSkill(taskDescription: string, taskResult: string, success: boolean): Promise<SkillExtractionResult>;
    searchSkills(taskDescription: string, limit?: number): Promise<SkillMatch[]>;
    useSkill(skillId: string): Skill | undefined;
    feedbackSkill(skillId: string, success: boolean, feedback?: string): void;
    evolveSkill(skillId: string): Promise<boolean>;
    exportForSharing(): Skill[];
    importSharedSkill(skill: Skill): void;
    getAll(): Skill[];
    getById(id: string): Skill | undefined;
    getStats(): {
        total: number;
        avgSuccessRate: number;
        totalUsage: number;
    };
    private findSimilar;
    private save;
    private load;
}
export {};
//# sourceMappingURL=skill-library.d.ts.map