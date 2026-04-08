"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskExecutor = void 0;
exports.getTaskExecutor = getTaskExecutor;
exports.createTaskRequest = createTaskRequest;
const crypto_1 = require("crypto");
const index_1 = require("./tools/index");
const skill_library_1 = require("./skill-library");
const reflexion_1 = require("./reflexion");
// Internal cancel registry
const activeTasks = new Map();
// ─── System Prompts ───────────────────────────────────────────────────────────
function buildSystemPrompt(task, ownerContext) {
    const role = {
        chat: 'You are a helpful AI assistant. Respond clearly and concisely.',
        code: 'You are an expert software engineer. Write clean, production-ready code with best practices. Include brief explanations when helpful.',
        research: 'You are a thorough research analyst. Gather information, synthesize findings, and present structured summaries with key insights.',
        analyze: 'You are a precise data and systems analyst. Break down problems methodically, identify patterns, and provide actionable conclusions.',
        create: 'You are a creative professional. Produce original, high-quality content tailored to the request.',
        custom: 'You are a capable AI assistant. Follow the user instructions precisely.',
    }[task.type];
    const parts = [role];
    if (ownerContext) {
        parts.push(`\nContext about your principal:\n${ownerContext}`);
    }
    if (task.context) {
        parts.push(`\nTask context:\n${task.context}`);
    }
    return parts.join('\n');
}
// ─── TaskExecutor ─────────────────────────────────────────────────────────────
class TaskExecutor {
    aiClient;
    ownerMemory;
    history = [];
    skillLibrary;
    reflexion;
    constructor(aiClient, ownerMemory, opts) {
        this.aiClient = aiClient;
        this.ownerMemory = ownerMemory;
        if (opts?.nodeId) {
            // LLM adapter for SkillLibrary/Reflexion (duck-typed)
            const llmAdapter = {
                chat: async (messages, chatOpts) => {
                    const result = await aiClient.call({
                        systemPrompt: 'You are a JSON-only response engine. Return valid JSON only.',
                        messages: messages,
                        maxTokens: 2048,
                    });
                    return result.content;
                }
            };
            this.skillLibrary = new skill_library_1.SkillLibrary(opts.nodeId, llmAdapter);
            this.reflexion = new reflexion_1.Reflexion(opts.nodeId, llmAdapter);
        }
    }
    // ── Main execute (with learning) ─────────────────────────────────────────────
    async execute(task) {
        const tools = task.tools ?? (0, index_1.getToolsForLevel)(task.permissionLevel ?? 0);
        if (tools.length > 0) {
            return this.executeWithTools(task, tools);
        }
        const start = Date.now();
        const ac = new AbortController();
        activeTasks.set(task.id, ac);
        // ── Pre-task: query skills + reflexion context ──
        const learningContext = await this._buildLearningContext(task.prompt);
        const usedSkillIds = learningContext.skillIds;
        try {
            const ownerCtx = this._buildOwnerContext();
            const systemPrompt = buildSystemPrompt(task, ownerCtx);
            // Inject learning context into prompt
            const enrichedPrompt = learningContext.text
                ? `${task.prompt}\n\n${learningContext.text}`
                : task.prompt;
            const result = await this.aiClient.call({
                systemPrompt,
                messages: [{ role: 'user', content: enrichedPrompt }],
                model: task.model,
                maxTokens: task.maxTokens ?? 4096,
            });
            const taskResult = {
                taskId: task.id,
                status: 'completed',
                output: result.content,
                tokenUsage: {
                    input: result.usage.inputTokens,
                    output: result.usage.outputTokens,
                },
                model: task.model ?? 'default',
                duration: Date.now() - start,
            };
            this.history.unshift(taskResult);
            if (this.history.length > 100)
                this.history.pop();
            // ── Post-task: extract skill + reflect (async, non-blocking) ──
            this._postTaskLearning(task, taskResult, usedSkillIds).catch(() => { });
            return taskResult;
        }
        catch (err) {
            const taskResult = {
                taskId: task.id,
                status: ac.signal.aborted ? 'cancelled' : 'failed',
                output: '',
                tokenUsage: { input: 0, output: 0 },
                model: task.model ?? 'default',
                duration: Date.now() - start,
                error: err.message,
            };
            this.history.unshift(taskResult);
            // Reflect on failure too
            this._postTaskLearning(task, taskResult, usedSkillIds).catch(() => { });
            return taskResult;
        }
        finally {
            activeTasks.delete(task.id);
        }
    }
    // ── Tool-use loop ────────────────────────────────────────────────────────────
    async executeWithTools(task, tools) {
        const start = Date.now();
        const ac = new AbortController();
        activeTasks.set(task.id, ac);
        const allToolCalls = [];
        let totalInput = 0;
        let totalOutput = 0;
        let usedModel = task.model ?? 'default';
        try {
            const ownerCtx = this._buildOwnerContext();
            const systemPrompt = buildSystemPrompt(task, ownerCtx);
            // Convert ToolDefinitions to Anthropic tool format
            const toolDefs = tools.map(t => ({
                name: t.name,
                description: t.description,
                input_schema: t.parameters,
            }));
            const messages = [
                { role: 'user', content: task.prompt },
            ];
            const MAX_ROUNDS = 10;
            let finalText = '';
            for (let round = 0; round < MAX_ROUNDS; round++) {
                if (ac.signal.aborted)
                    throw new Error('Task cancelled');
                const res = await this.aiClient.chatWithTools(messages, toolDefs, {
                    systemPrompt,
                    model: task.model,
                    maxTokens: task.maxTokens ?? 4096,
                });
                totalInput += res.usage.inputTokens;
                totalOutput += res.usage.outputTokens;
                usedModel = res.model;
                if (res.stopReason === 'end_turn' || !res.toolUses?.length) {
                    finalText = res.content;
                    break;
                }
                // Append assistant message
                messages.push({ role: 'assistant', content: res.rawContent });
                // Execute tool calls
                const toolResults = [];
                for (const toolUse of res.toolUses) {
                    const toolResult = await (0, index_1.executeTool)(toolUse.name, toolUse.input, task.permissionLevel ?? 0);
                    allToolCalls.push(toolResult);
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: toolUse.id,
                        content: toolResult.error
                            ? `Error: ${toolResult.error}`
                            : toolResult.result,
                    });
                }
                messages.push({ role: 'user', content: toolResults });
                if (!res.toolUses.length) {
                    finalText = res.content;
                    break;
                }
            }
            const taskResult = {
                taskId: task.id,
                status: 'completed',
                output: finalText,
                tokenUsage: { input: totalInput, output: totalOutput },
                model: usedModel,
                duration: Date.now() - start,
                toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
            };
            this.history.unshift(taskResult);
            if (this.history.length > 100)
                this.history.pop();
            return taskResult;
        }
        catch (err) {
            const taskResult = {
                taskId: task.id,
                status: ac.signal.aborted ? 'cancelled' : 'failed',
                output: '',
                tokenUsage: { input: totalInput, output: totalOutput },
                model: usedModel,
                duration: Date.now() - start,
                error: err.message,
                toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
            };
            this.history.unshift(taskResult);
            return taskResult;
        }
        finally {
            activeTasks.delete(task.id);
        }
    }
    // ── Streaming ────────────────────────────────────────────────────────────────
    async *stream(task) {
        const ownerCtx = this._buildOwnerContext();
        const systemPrompt = buildSystemPrompt(task, ownerCtx);
        const ac = new AbortController();
        activeTasks.set(task.id, ac);
        try {
            yield* this.aiClient.stream([{ role: 'user', content: task.prompt }], {
                systemPrompt,
                model: task.model,
                maxTokens: task.maxTokens ?? 4096,
                signal: ac.signal,
            });
        }
        finally {
            activeTasks.delete(task.id);
        }
    }
    // ── Cancel ───────────────────────────────────────────────────────────────────
    cancel(taskId) {
        const ac = activeTasks.get(taskId);
        if (ac) {
            ac.abort();
            activeTasks.delete(taskId);
            console.log(`[task-executor] Cancelled task ${taskId}`);
        }
    }
    // ── History ──────────────────────────────────────────────────────────────────
    getHistory(limit = 20) {
        return this.history.slice(0, limit);
    }
    // ── Helpers ──────────────────────────────────────────────────────────────────
    _buildOwnerContext() {
        try {
            const entries = this.ownerMemory.get();
            if (!entries.length)
                return '';
            return entries
                .slice(0, 10)
                .map(e => `[${e.type}] ${e.content}`)
                .join('\n');
        }
        catch {
            return '';
        }
    }
    // ── Learning: pre-task context ──────────────────────────────────────────────
    async _buildLearningContext(prompt) {
        const parts = [];
        const skillIds = [];
        // 1. Search relevant skills
        if (this.skillLibrary) {
            try {
                const matches = await this.skillLibrary.searchSkills(prompt, 3);
                if (matches.length > 0) {
                    parts.push('--- RELEVANT SKILLS FROM PAST EXPERIENCE ---');
                    for (const m of matches) {
                        const skill = this.skillLibrary.useSkill(m.skill.id);
                        if (skill) {
                            skillIds.push(skill.id);
                            parts.push(`[Skill: ${skill.name}] (success rate: ${Math.round(skill.successRate * 100)}%)`);
                            parts.push(skill.code);
                            parts.push('');
                        }
                    }
                    parts.push('--- END SKILLS ---');
                }
            }
            catch { /* skill search failed, continue without */ }
        }
        // 2. Get reflexion context
        if (this.reflexion) {
            try {
                const ctx = this.reflexion.getReflexionContext(prompt);
                if (ctx.summary) {
                    parts.push('');
                    parts.push('--- SELF-REFLECTION FROM PAST TASKS ---');
                    parts.push(ctx.summary);
                    if (ctx.chainedStrategy) {
                        parts.push(`⚠️ ${ctx.chainedStrategy}`);
                    }
                    parts.push('--- END REFLECTION ---');
                }
            }
            catch { /* reflexion failed, continue without */ }
        }
        return { text: parts.join('\n'), skillIds };
    }
    // ── Learning: post-task extraction + reflection ─────────────────────────────
    async _postTaskLearning(task, result, usedSkillIds) {
        const success = result.status === 'completed';
        // 1. Extract skill from successful tasks
        if (this.skillLibrary && success) {
            try {
                await this.skillLibrary.extractSkill(task.prompt, result.output, true);
            }
            catch { /* non-critical */ }
            // Feedback on used skills
            for (const skillId of usedSkillIds) {
                this.skillLibrary.feedbackSkill(skillId, success);
            }
            // Evolve skills that have been used enough
            for (const skillId of usedSkillIds) {
                try {
                    await this.skillLibrary.evolveSkill(skillId);
                }
                catch { /* non-critical */ }
            }
        }
        // 2. Generate reflection
        if (this.reflexion) {
            try {
                await this.reflexion.reflect({
                    taskId: task.id,
                    taskDescription: task.prompt.slice(0, 500),
                    taskResult: result.output.slice(0, 1500),
                    success,
                    duration: result.duration,
                    tokenUsage: result.tokenUsage,
                    skillsUsed: usedSkillIds,
                });
            }
            catch { /* non-critical */ }
        }
    }
    // ── Expose learning modules for external access ─────────────────────────────
    getSkillLibrary() {
        return this.skillLibrary;
    }
    getReflexion() {
        return this.reflexion;
    }
}
exports.TaskExecutor = TaskExecutor;
// ─── Singleton factory ────────────────────────────────────────────────────────
const executors = new Map();
function getTaskExecutor(nodeId, aiClient, ownerMemory) {
    if (!executors.has(nodeId)) {
        executors.set(nodeId, new TaskExecutor(aiClient, ownerMemory, { nodeId }));
    }
    return executors.get(nodeId);
}
function createTaskRequest(prompt, type = 'chat', overrides = {}) {
    return {
        id: (0, crypto_1.randomUUID)(),
        type,
        prompt,
        ...overrides,
    };
}
//# sourceMappingURL=task-executor.js.map