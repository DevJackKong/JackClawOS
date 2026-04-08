"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerHarnessRunner = registerHarnessRunner;
exports.createServer = createServer;
exports.handleTask = handleTask;
const express_1 = __importDefault(require("express"));
const protocol_1 = require("@jackclaw/protocol");
const ai_client_1 = require("./ai-client");
const owner_memory_1 = require("./owner-memory");
const task_planner_1 = require("./task-planner");
const task_executor_1 = require("./task-executor");
const owner_auth_1 = require("./routes/owner-auth");
const workload_tracker_1 = require("./workload-tracker");
const performance_ledger_1 = require("./performance-ledger");
const llm_gateway_1 = require("./llm-gateway");
let harnessRunner = null;
function registerHarnessRunner(runner) {
    harnessRunner = runner;
}
function createServer(identity, config, chatClient) {
    const app = (0, express_1.default)();
    app.use(express_1.default.json({ limit: '1mb' }));
    // Workload tracker — scoped to this server instance
    const workloadTracker = new workload_tracker_1.WorkloadTracker(identity.nodeId);
    // ── Health check ────────────────────────────────────────────────────────────
    app.get('/health', (_req, res) => {
        res.json({
            status: 'ok',
            uptime: process.uptime(),
            hubConnected: chatClient ? chatClient.isConnected() : null,
            nodeId: identity.nodeId,
            ts: Date.now(),
            workload: workloadTracker.getSnapshot(),
        });
    });
    // ── Ask: direct LLM call via gateway ──────────────────────────────────────
    // POST /api/ask  { model?, prompt, systemPrompt? }
    // → { answer, model, provider, tokens, latencyMs, costUsd }
    app.post('/api/ask', async (req, res) => {
        const { prompt, model, systemPrompt, temperature, max_tokens } = req.body;
        if (!prompt) {
            res.status(400).json({ error: 'prompt required' });
            return;
        }
        const gateway = (0, llm_gateway_1.getNodeGateway)();
        if (!gateway) {
            res.status(503).json({ error: 'LLM gateway not initialized' });
            return;
        }
        const targetModel = model || config.ai.model;
        const sys = systemPrompt || `You are ${identity.nodeId}, a JackClaw agent (role: ${config.nodeRole ?? 'worker'}).`;
        try {
            const result = await gateway.chat({
                model: targetModel,
                messages: [
                    { role: 'system', content: sys },
                    { role: 'user', content: prompt },
                ],
                temperature: temperature ?? 0.7,
                max_tokens: max_tokens ?? 2048,
            });
            const answer = result.choices[0]?.message.content ?? '';
            const costUsd = gateway.estimateCost(targetModel, result.usage.prompt_tokens, result.usage.completion_tokens);
            res.json({
                answer,
                model: result.model,
                provider: result.provider,
                tokens: result.usage,
                latencyMs: result.latencyMs,
                costUsd,
            });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // ── List available providers ───────────────────────────────────────────────
    app.get('/api/providers', (_req, res) => {
        const gateway = (0, llm_gateway_1.getNodeGateway)();
        if (!gateway) {
            res.json({ providers: [] });
            return;
        }
        res.json({ providers: gateway.listProviders(), stats: gateway.getStats() });
    });
    // ── Memory semantic search ─────────────────────────────────────────────────
    // POST /api/memory/search  { query, topK?, useEmbeddings? }
    app.post('/api/memory/search', async (req, res) => {
        const { query, topK = 5, useEmbeddings = false } = req.body;
        if (!query) {
            res.status(400).json({ error: 'query required' });
            return;
        }
        try {
            const { MemoryManager } = await Promise.resolve().then(() => __importStar(require('@jackclaw/memory')));
            const mm = new MemoryManager();
            const gateway = (0, llm_gateway_1.getNodeGateway)();
            // Optional: use LLM embeddings for better semantic matching
            let embedder;
            if (useEmbeddings && gateway) {
                embedder = async (text) => {
                    // Use OpenAI embeddings if available, otherwise TF-IDF fallback
                    try {
                        const r = await gateway.chat({
                            model: 'text-embedding-3-small',
                            messages: [{ role: 'user', content: text }],
                        });
                        // Parse embedding from response (provider-specific)
                        return r.raw?.data?.[0]?.embedding ?? [];
                    }
                    catch {
                        return []; // fallback to TF-IDF
                    }
                };
            }
            const results = await mm.semanticQuery(identity.nodeId, query, topK, embedder);
            res.json({ query, results, total: results.length });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // ── Receive task from Hub ───────────────────────────────────────────────────
    app.post('/api/task', (req, res) => {
        if (!config.visibility.shareTasks) {
            res.status(403).json({ error: 'Task acceptance disabled by node config' });
            return;
        }
        const msg = req.body;
        if (!msg || !msg.payload || !msg.signature) {
            res.status(400).json({ error: 'Invalid message format' });
            return;
        }
        // Hub must identify itself; for now we trust messages from 'hub'
        // In production, store Hub's public key in config
        const hubPublicKey = config.hubPublicKey;
        if (!hubPublicKey) {
            // Accept without verification if Hub key not configured (dev mode)
            console.warn('[server] Hub public key not configured — skipping signature verification');
            try {
                const raw = JSON.parse(msg.payload);
                const plaintext = (0, protocol_1.decrypt)(raw, identity.privateKey);
                const task = JSON.parse(plaintext);
                console.log(`[server] Received task: ${task.taskId} — ${task.action}`);
                handleTask(task, identity, config);
                res.json({ status: 'accepted', taskId: task.taskId });
            }
            catch (err) {
                console.error('[server] Failed to process task:', err.message);
                res.status(422).json({ error: 'Failed to process task' });
            }
            return;
        }
        // Verified path
        try {
            const task = (0, protocol_1.openMessage)(msg, hubPublicKey, identity.privateKey);
            console.log(`[server] Received verified task: ${task.taskId} — ${task.action}`);
            handleTask(task, identity, config);
            res.json({ status: 'accepted', taskId: task.taskId });
        }
        catch (err) {
            console.error('[server] Task verification/decryption failed:', err.message);
            res.status(422).json({ error: 'Failed to verify or decrypt task' });
        }
    });
    // ── Ping ────────────────────────────────────────────────────────────────────
    app.post('/api/ping', (_req, res) => {
        res.json({ pong: true, nodeId: identity.nodeId, ts: Date.now() });
    });
    // ── Task Plan（规划引擎）────────────────────────────────────────────────────
    // POST /api/plan { taskId, title, description, useAi? }
    // 返回完整 ExecutionPlan + 格式化文本
    app.post('/api/plan', (req, res) => {
        const { taskId, title, description, useAi } = req.body ?? {};
        if (!title || !description) {
            res.status(400).json({ error: 'title and description required' });
            return;
        }
        const aiClient = (0, ai_client_1.getAiClient)(identity.nodeId, config);
        const planner = new task_planner_1.TaskPlanner(aiClient);
        planner.plan({
            taskId: taskId ?? `plan-${Date.now()}`,
            title,
            description,
            useAi: useAi !== false,
        }).then(plan => {
            res.json({ plan, formatted: (0, task_planner_1.formatPlan)(plan) });
        }).catch(err => {
            res.status(500).json({ error: err.message });
        });
    });
    // ── OwnerMemory 授权区 ───────────────────────────────────────────────────────
    app.use('/api/owner', (0, owner_auth_1.createOwnerAuthRouter)(identity));
    // ── LLM Task Execution ────────────────────────────────────────────────────────
    // POST /api/tasks/execute { id, type, prompt, context?, model?, maxTokens?, permissionLevel? }
    app.post('/api/tasks/execute', async (req, res) => {
        const { id, type = 'chat', prompt, context, model, maxTokens, permissionLevel } = req.body ?? {};
        if (!prompt) {
            res.status(400).json({ error: 'prompt is required' });
            return;
        }
        const aiClient = (0, ai_client_1.getAiClient)(identity.nodeId, config);
        const ownerMemory = (0, owner_memory_1.getOwnerMemory)(identity.nodeId);
        const executor = (0, task_executor_1.getTaskExecutor)(identity.nodeId, aiClient, ownerMemory);
        const taskReq = (0, task_executor_1.createTaskRequest)(prompt, type, {
            id,
            context,
            model,
            maxTokens,
            permissionLevel: permissionLevel ?? 0,
        });
        try {
            const result = await executor.execute(taskReq);
            res.json(result);
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    // POST /api/tasks/:id/cancel
    app.post('/api/tasks/:taskId/cancel', (req, res) => {
        const aiClient = (0, ai_client_1.getAiClient)(identity.nodeId, config);
        const ownerMemory = (0, owner_memory_1.getOwnerMemory)(identity.nodeId);
        const executor = (0, task_executor_1.getTaskExecutor)(identity.nodeId, aiClient, ownerMemory);
        executor.cancel(req.params.taskId);
        res.json({ taskId: req.params.taskId, status: 'cancelled' });
    });
    // GET /api/tasks/history
    app.get('/api/tasks/history', (req, res) => {
        const limit = Number(req.query.limit ?? 20);
        const aiClient = (0, ai_client_1.getAiClient)(identity.nodeId, config);
        const ownerMemory = (0, owner_memory_1.getOwnerMemory)(identity.nodeId);
        const executor = (0, task_executor_1.getTaskExecutor)(identity.nodeId, aiClient, ownerMemory);
        res.json({ history: executor.getHistory(limit) });
    });
    // ── Performance Ledger ───────────────────────────────────────────────────────
    app.get('/api/performance/stats', (_req, res) => {
        res.json((0, performance_ledger_1.getPerformanceLedger)().weeklyStats());
    });
    // GET /api/performance/recommendation — 自动调优建议
    app.get('/api/performance/recommendation', (_req, res) => {
        const stats = (0, performance_ledger_1.getPerformanceLedger)().weeklyStats();
        const retryTuning = (0, performance_ledger_1.getPerformanceLedger)().autoTuneRetry();
        res.json({ recommendation: stats.recommendation, retryTuning });
    });
    // ── Watchdog Heartbeat (every 60s) ────────────────────────────────────────────
    const hubUrl = config.hubUrl;
    if (hubUrl) {
        const heartbeatInterval = setInterval(() => {
            const metrics = {
                memUsage: process.memoryUsage().heapUsed,
                uptime: process.uptime(),
                cpuLoad: 0,
                tasksCompleted: 0,
                lastTaskAt: Date.now(),
            };
            const body = JSON.stringify({ nodeId: identity.nodeId, metrics });
            const url = new URL('/api/watchdog/heartbeat', hubUrl);
            const mod = url.protocol === 'https:' ? require('https') : require('http');
            const req = mod.request(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            }, (res) => { res.resume(); });
            req.on('error', () => { });
            req.end(body);
        }, 60_000);
        // Prevent timer from keeping process alive
        heartbeatInterval.unref();
    }
    // ── Error handler ───────────────────────────────────────────────────────────
    app.use((err, _req, res, _next) => {
        console.error('[server] Unhandled error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    });
    return app;
}
function handleTask(task, identity, config) {
    console.log(`[task] Handling task ${task.taskId}: ${task.action}`, task.params);
    // 所有 harness/ai 任务先自动规划，打印计划后再执行
    if ((task.action === 'harness' || task.action === 'ai') && task.params?.description) {
        const aiClient = (0, ai_client_1.getAiClient)(identity.nodeId, config);
        const planner = new task_planner_1.TaskPlanner(aiClient);
        // 非阻塞：规划和执行同时启动，规划完打印计划
        planner.plan({
            taskId: task.taskId,
            title: task.params.title || task.taskId,
            description: task.params.description,
            useAi: true,
        }).then(plan => {
            console.log('\n' + (0, task_planner_1.formatPlan)(plan) + '\n');
        }).catch(() => { });
    }
    // action='harness' → 接入 Harness 执行链
    if (task.action === 'harness' && task.params?.description) {
        if (!harnessRunner) {
            console.warn('[task] No harness runner registered, skipping');
            return;
        }
        harnessRunner({
            taskId: task.taskId,
            title: task.params.title || task.taskId,
            description: task.params.description,
            workdir: task.params.workdir || config.workspaceDir,
            requireApproval: !!(task.params.requireApproval),
        }).then(r => console.log(`[task] ${task.taskId} → ${r.status} (${r.attempts} attempts)`))
            .catch(err => console.error('[task] harness error:', err.message));
        return;
    }
    // action='ai' → 通过 LLM Gateway 调用（支持任意 provider + 自动 fallback）
    if (task.action === 'ai' && task.params?.prompt) {
        const gateway = (0, llm_gateway_1.getNodeGateway)();
        const prompt = task.params.prompt;
        const model = task.params.model || config.ai.model;
        const systemPrompt = task.params.systemPrompt || `You are ${identity.nodeId}, a JackClaw agent node (role: ${config.nodeRole ?? 'worker'}). Complete the task concisely.`;
        if (gateway) {
            // Gateway available — use it (supports all providers + fallback chain)
            gateway.chat({
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt },
                ],
                max_tokens: task.params.maxTokens || 2048,
                temperature: task.params.temperature || 0.7,
            }).then(result => {
                const answer = result.choices[0]?.message.content ?? '';
                const stats = gateway.getStats();
                console.log(`[task] ${task.taskId} ai[${result.provider}/${result.model}] → ${result.usage.total_tokens} tokens, ${result.latencyMs}ms`);
                console.log(`[task] Answer: ${answer.slice(0, 100)}${answer.length > 100 ? '...' : ''}`);
                console.log(`[gateway] Total cost so far: $${stats.totalCostUsd.toFixed(6)}`);
            }).catch(err => console.error('[task] gateway ai error:', err.message));
        }
        else {
            // Fallback to legacy ai-client
            const aiClient = (0, ai_client_1.getAiClient)(identity.nodeId, config);
            aiClient.call({
                systemPrompt,
                messages: [{ role: 'user', content: prompt }],
                queryContext: prompt,
            }).then(result => {
                console.log(`[task] ${task.taskId} ai[legacy] → attempts=${result.attempts} tokens=${result.usage.inputTokens}`);
            }).catch(err => console.error('[task] ai error:', err.message));
        }
        return;
    }
    // action='chat-reply' → 自动回复 ClawChat 消息（LLM 生成回复）
    if (task.action === 'chat-reply' && task.params?.message) {
        const gateway = (0, llm_gateway_1.getNodeGateway)();
        if (!gateway)
            return;
        const incomingMsg = task.params.message;
        const from = task.params.from;
        const model = task.params.model || config.ai.model;
        gateway.chat({
            model,
            messages: [
                { role: 'system', content: `You are ${identity.nodeId} (${config.nodeRole ?? 'worker'}). Reply concisely to your colleague's message.` },
                { role: 'user', content: incomingMsg },
            ],
            max_tokens: 512,
            temperature: 0.8,
        }).then(result => {
            const reply = result.choices[0]?.message.content ?? '';
            console.log(`[chat-reply] ${from} → ${identity.nodeId}: "${incomingMsg.slice(0, 40)}"`);
            console.log(`[chat-reply] ${identity.nodeId} → ${from}: "${reply.slice(0, 80)}"`);
        }).catch(err => console.error('[chat-reply] error:', err.message));
        return;
    }
}
//# sourceMappingURL=server.js.map