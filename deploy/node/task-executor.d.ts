/**
 * TaskExecutor — LLM Task Execution Engine
 *
 * 负责将结构化任务请求路由到 LLM，支持：
 * - 多任务类型（chat/code/research/analyze/create/custom）
 * - 工具调用循环（function calling）
 * - 流式输出
 * - 任务取消
 * - 执行历史
 */
import type { AiClient } from './ai-client';
import type { OwnerMemory } from './owner-memory';
import type { ToolDefinition, ToolCallResult } from './tools/index';
import { SkillLibrary } from './skill-library';
import { Reflexion } from './reflexion';
export interface TaskRequest {
    id: string;
    type: 'chat' | 'code' | 'research' | 'analyze' | 'create' | 'custom';
    prompt: string;
    context?: string;
    tools?: ToolDefinition[];
    model?: string;
    maxTokens?: number;
    temperature?: number;
    stream?: boolean;
    /** Permission level for built-in tools: 0=none, 1=web, 2=+files, 3=+shell */
    permissionLevel?: 0 | 1 | 2 | 3;
}
export interface TaskResult {
    taskId: string;
    status: 'completed' | 'failed' | 'cancelled';
    output: string;
    tokenUsage: {
        input: number;
        output: number;
    };
    model: string;
    duration: number;
    toolCalls?: ToolCallResult[];
    error?: string;
}
export declare class TaskExecutor {
    private aiClient;
    private ownerMemory;
    private history;
    private skillLibrary?;
    private reflexion?;
    constructor(aiClient: AiClient, ownerMemory: OwnerMemory, opts?: {
        nodeId?: string;
    });
    execute(task: TaskRequest): Promise<TaskResult>;
    executeWithTools(task: TaskRequest, tools: ToolDefinition[]): Promise<TaskResult>;
    stream(task: TaskRequest): AsyncGenerator<string>;
    cancel(taskId: string): void;
    getHistory(limit?: number): TaskResult[];
    private _buildOwnerContext;
    private _buildLearningContext;
    private _postTaskLearning;
    getSkillLibrary(): SkillLibrary | undefined;
    getReflexion(): Reflexion | undefined;
}
export declare function getTaskExecutor(nodeId: string, aiClient: AiClient, ownerMemory: OwnerMemory): TaskExecutor;
export declare function createTaskRequest(prompt: string, type?: TaskRequest['type'], overrides?: Partial<TaskRequest>): TaskRequest;
//# sourceMappingURL=task-executor.d.ts.map