/**
 * auto-task.ts — AutoTaskRunner: autonomous task chain executor
 *
 * Decomposes a high-level goal into sub-steps via LLM, then executes them
 * sequentially, feeding each step's result as context for the next.
 * Supports pause-for-human, per-step retry, and persistence for resume.
 */
import type { JackClawConfig } from './config';
export interface SubTask {
    step: number;
    description: string;
    type: 'llm' | 'tool' | 'ask_human';
    tool?: string;
    args?: any;
    dependsOn?: number[];
    status: 'pending' | 'running' | 'completed' | 'failed';
    result?: string;
    error?: string;
    attempts?: number;
}
export interface AutoTaskResult {
    goal: string;
    taskId: string;
    steps: SubTask[];
    finalOutput: string;
    totalTokens: {
        input: number;
        output: number;
    };
    duration: number;
    status: 'completed' | 'failed' | 'paused_for_human';
}
export interface AutoTaskOptions {
    /** Call onStepComplete after each step. Default: true */
    notifyOwner?: boolean;
    /** Stop after this many steps (prevent infinite loops). Default: 10 */
    maxSteps?: number;
    /** Per-step retry limit. Default: 3 */
    maxRetries?: number;
    /** Override the default LLM model */
    model?: string;
    /** Called after each completed step when notifyOwner is true */
    onStepComplete?: (step: SubTask) => void | Promise<void>;
}
export declare class AutoTaskRunner {
    private nodeId;
    private config;
    private aiClient;
    private opts;
    constructor(nodeId: string, config: JackClawConfig, opts?: AutoTaskOptions);
    /** Decompose goal into sub-tasks, then execute all of them in sequence. */
    run(goal: string): Promise<AutoTaskResult>;
    /** Only plan — decompose goal into sub-tasks without executing. */
    plan(goal: string): Promise<SubTask[]>;
    /** Resume a paused or interrupted task by its taskId. */
    resume(taskId: string): Promise<AutoTaskResult>;
    private _execute;
    private _executeStep;
    private _parsePlan;
}
//# sourceMappingURL=auto-task.d.ts.map