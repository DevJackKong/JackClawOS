"use strict";
/**
 * auto-task.ts — AutoTaskRunner: autonomous task chain executor
 *
 * Decomposes a high-level goal into sub-steps via LLM, then executes them
 * sequentially, feeding each step's result as context for the next.
 * Supports pause-for-human, per-step retry, and persistence for resume.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutoTaskRunner = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const crypto_1 = require("crypto");
const ai_client_1 = require("./ai-client");
// ─── Persistence ──────────────────────────────────────────────────────────────
const TASKS_DIR = path_1.default.join(os_1.default.homedir(), '.jackclaw', 'node', 'auto-tasks');
function saveTask(task) {
    fs_1.default.mkdirSync(TASKS_DIR, { recursive: true });
    fs_1.default.writeFileSync(path_1.default.join(TASKS_DIR, `${task.taskId}.json`), JSON.stringify(task, null, 2));
}
function loadTask(taskId) {
    const file = path_1.default.join(TASKS_DIR, `${taskId}.json`);
    if (!fs_1.default.existsSync(file))
        return null;
    try {
        return JSON.parse(fs_1.default.readFileSync(file, 'utf8'));
    }
    catch {
        return null;
    }
}
// ─── AutoTaskRunner ───────────────────────────────────────────────────────────
class AutoTaskRunner {
    nodeId;
    config;
    aiClient;
    opts;
    constructor(nodeId, config, opts) {
        this.nodeId = nodeId;
        this.config = config;
        this.aiClient = (0, ai_client_1.getAiClient)(nodeId, config);
        this.opts = {
            notifyOwner: opts?.notifyOwner ?? true,
            maxSteps: opts?.maxSteps ?? 10,
            maxRetries: opts?.maxRetries ?? 3,
            model: opts?.model ?? config.ai.model,
            onStepComplete: opts?.onStepComplete ?? (() => { }),
        };
    }
    // ── Public API ──────────────────────────────────────────────────────────────
    /** Decompose goal into sub-tasks, then execute all of them in sequence. */
    async run(goal) {
        const taskId = (0, crypto_1.randomUUID)();
        const startedAt = Date.now();
        const steps = await this.plan(goal);
        // Persist initial state
        saveTask({ goal, taskId, steps, status: 'completed', startedAt });
        return this._execute(goal, taskId, steps, startedAt);
    }
    /** Only plan — decompose goal into sub-tasks without executing. */
    async plan(goal) {
        const systemPrompt = `You are a task decomposition expert.
Break down the given goal into clear, sequential steps that an AI agent can execute.
Output ONLY a JSON array — no explanations, no markdown fences.`;
        const prompt = `Goal: ${goal}

Decompose into sequential steps (max ${this.opts.maxSteps}). Output a JSON array:
[
  { "step": 1, "description": "...", "type": "llm" },
  { "step": 2, "description": "...", "type": "llm", "dependsOn": [1] }
]

Rules:
- type "llm"        = AI reasoning / text generation
- type "tool"       = external tool call (add "tool" and "args" fields)
- type "ask_human"  = requires human input before proceeding
- Maximum ${this.opts.maxSteps} steps
- Each step must be concrete and actionable`;
        const result = await this.aiClient.call({
            systemPrompt,
            messages: [{ role: 'user', content: prompt }],
            model: this.opts.model,
            maxTokens: 2048,
        });
        return this._parsePlan(result.content);
    }
    /** Resume a paused or interrupted task by its taskId. */
    async resume(taskId) {
        const persisted = loadTask(taskId);
        if (!persisted) {
            throw new Error(`Task not found: ${taskId}`);
        }
        // Reset failed/running steps back to pending so they're retried
        for (const step of persisted.steps) {
            if (step.status === 'running' || step.status === 'failed') {
                step.status = 'pending';
                step.error = undefined;
                step.attempts = 0;
            }
        }
        return this._execute(persisted.goal, taskId, persisted.steps, persisted.startedAt);
    }
    // ── Execution engine ────────────────────────────────────────────────────────
    async _execute(goal, taskId, steps, startedAt) {
        const totalTokens = { input: 0, output: 0 };
        const contextParts = [`Goal: ${goal}`];
        let finalOutput = '';
        let taskStatus = 'completed';
        for (const step of steps) {
            if (step.status === 'completed') {
                // Already done (resuming) — include prior result in context
                if (step.result)
                    contextParts.push(`Step ${step.step} result: ${step.result}`);
                continue;
            }
            // Guard: total steps executed (pending → completed) capped at maxSteps
            const executedCount = steps.filter(s => s.status === 'completed').length;
            if (executedCount >= this.opts.maxSteps) {
                step.status = 'failed';
                step.error = 'maxSteps limit reached';
                finalOutput = `Stopped after ${this.opts.maxSteps} steps (limit reached). Last output: ${contextParts[contextParts.length - 1] ?? ''}`;
                taskStatus = 'failed';
                break;
            }
            // Pause for human
            if (step.type === 'ask_human') {
                step.status = 'pending';
                finalOutput = `Paused at step ${step.step}: "${step.description}". Human input required.`;
                taskStatus = 'paused_for_human';
                saveTask({ goal, taskId, steps, status: taskStatus, startedAt });
                break;
            }
            // Execute with retry
            step.status = 'running';
            step.attempts = 0;
            let lastError = '';
            for (let attempt = 1; attempt <= this.opts.maxRetries; attempt++) {
                step.attempts = attempt;
                try {
                    const { result, tokens } = await this._executeStep(step, contextParts.join('\n\n'));
                    step.result = result;
                    step.status = 'completed';
                    totalTokens.input += tokens.input;
                    totalTokens.output += tokens.output;
                    contextParts.push(`Step ${step.step} result: ${result}`);
                    finalOutput = result;
                    lastError = '';
                    break;
                }
                catch (err) {
                    lastError = err?.message ?? String(err);
                    console.warn(`[auto-task] step=${step.step} attempt=${attempt} error: ${lastError}`);
                    if (attempt < this.opts.maxRetries) {
                        await new Promise(r => setTimeout(r, 500 * attempt));
                    }
                }
            }
            if (step.status !== 'completed') {
                step.status = 'failed';
                step.error = lastError;
                finalOutput = `Failed at step ${step.step}: ${lastError}`;
                taskStatus = 'failed';
                break;
            }
            // Notify owner
            if (this.opts.notifyOwner) {
                try {
                    await this.opts.onStepComplete(step);
                }
                catch (notifyErr) {
                    console.warn('[auto-task] onStepComplete error:', notifyErr?.message);
                }
            }
            // Persist progress after each step
            saveTask({ goal, taskId, steps, status: taskStatus, startedAt });
        }
        const result = {
            goal,
            taskId,
            steps,
            finalOutput,
            totalTokens,
            duration: Date.now() - startedAt,
            status: taskStatus,
        };
        saveTask({ goal, taskId, steps, status: taskStatus, startedAt });
        return result;
    }
    async _executeStep(step, context) {
        if (step.type === 'tool') {
            // Tools are not wired here — callers can override onStepComplete to handle them.
            // Return a placeholder so the chain can continue.
            return {
                result: `[tool:${step.tool ?? 'unknown'}] args=${JSON.stringify(step.args ?? {})} (tool execution not implemented)`,
                tokens: { input: 0, output: 0 },
            };
        }
        // type === 'llm'
        const messages = [
            {
                role: 'user',
                content: `Context so far:\n${context}\n\nCurrent task:\n${step.description}\n\nComplete this step concisely.`,
            },
        ];
        const aiResult = await this.aiClient.call({
            systemPrompt: 'You are a focused AI assistant executing one step of a larger task. Be concise and precise.',
            messages,
            model: this.opts.model,
            maxTokens: 2048,
        });
        return {
            result: aiResult.content,
            tokens: {
                input: aiResult.usage.inputTokens,
                output: aiResult.usage.outputTokens,
            },
        };
    }
    // ── Plan parsing ────────────────────────────────────────────────────────────
    _parsePlan(raw) {
        // Extract JSON array, tolerating markdown code fences
        const match = raw.match(/\[[\s\S]*\]/);
        if (!match) {
            // Fallback: treat the entire goal as one LLM step
            return [{
                    step: 1,
                    description: 'Execute the goal directly',
                    type: 'llm',
                    status: 'pending',
                }];
        }
        try {
            const parsed = JSON.parse(match[0]);
            return parsed.slice(0, this.opts.maxSteps).map((s) => ({
                step: s.step,
                description: s.description,
                type: (s.type === 'tool' || s.type === 'ask_human') ? s.type : 'llm',
                tool: s.tool,
                args: s.args,
                dependsOn: s.dependsOn,
                status: 'pending',
            }));
        }
        catch {
            return [{
                    step: 1,
                    description: 'Execute the goal directly',
                    type: 'llm',
                    status: 'pending',
                }];
        }
    }
}
exports.AutoTaskRunner = AutoTaskRunner;
//# sourceMappingURL=auto-task.js.map