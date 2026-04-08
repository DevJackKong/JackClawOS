"use strict";
/**
 * JackClaw AI Client — SmartCache 原生集成
 *
 * 所有 LLM 调用统一走这里。自动：
 * 1. 探测中转站缓存能力（首次 + 每24h）
 * 2. 按能力选择最优 payload 策略（native/compressed/sliding）
 * 3. 记录 token 使用 + 统计节省量
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiClient = void 0;
exports.getAiClient = getAiClient;
const crypto_1 = require("crypto");
const smart_cache_1 = require("./smart-cache");
const auto_retry_1 = require("./auto-retry");
class AiClient {
    nodeId;
    config;
    cache;
    capability = null;
    lastProbeTime = 0;
    constructor(nodeId, config) {
        this.nodeId = nodeId;
        this.config = config;
        this.cache = (0, smart_cache_1.getSmartCache)(nodeId);
    }
    async call(opts) {
        await this.ensureCapabilityProbed();
        const retryEnabled = opts.retry?.enabled !== false;
        const maxAttempts = opts.retry?.maxAttempts ?? 3;
        let currentMessages = opts.messages;
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let totalSavedTokens = 0;
        let lastCacheRead = 0;
        let lastCacheWrite = 0;
        let lastStrategy = 'full';
        let lastContent = '';
        const retryHistory = [];
        for (let attempt = 1; attempt <= (retryEnabled ? maxAttempts : 1); attempt++) {
            const result = await this._singleCall({ ...opts, messages: currentMessages });
            totalInputTokens += result.usage.inputTokens;
            totalOutputTokens += result.usage.outputTokens;
            totalSavedTokens += result.usage.savedTokens;
            lastCacheRead = result.usage.cacheReadTokens;
            lastCacheWrite = result.usage.cacheWriteTokens;
            lastStrategy = result.strategy;
            lastContent = result.content;
            // 自定义成功判断
            if (opts.retry?.successEvaluator?.(result.content))
                break;
            const failureType = (0, auto_retry_1.classifyResponse)(result.content);
            if (failureType === 'success')
                break;
            retryHistory.push({ attempt, failureType, summary: result.content.slice(0, 100) });
            console.log(`[ai-client] attempt=${attempt} failure=${failureType}, retrying...`);
            // hard fail 不重试
            if (failureType === 'hard-capability' || failureType === 'hard-policy')
                break;
            if (attempt === maxAttempts)
                break;
            // 重写 prompt
            const contextHints = failureType === 'soft-context'
                ? opts.retry?.contextExtractor?.()
                : undefined;
            currentMessages = (0, auto_retry_1.rewritePrompt)(currentMessages, failureType, result.content, attempt, contextHints);
        }
        return {
            content: lastContent,
            usage: {
                inputTokens: totalInputTokens,
                outputTokens: totalOutputTokens,
                cacheReadTokens: lastCacheRead,
                cacheWriteTokens: lastCacheWrite,
                savedTokens: totalSavedTokens,
            },
            strategy: lastStrategy,
            attempts: retryHistory.length + 1,
            retryHistory: retryHistory.length > 0 ? retryHistory : undefined,
        };
    }
    /** 单次 API 调用（不含重试逻辑） */
    async _singleCall(opts) {
        const { ai } = this.config;
        const payload = this.cache.buildOptimalPayload({
            systemPrompt: opts.systemPrompt,
            memoryEntries: opts.memoryEntries ?? [],
            messages: opts.messages,
            queryContext: opts.queryContext,
            capability: this.capability,
            maxMemoryEntries: ai.maxMemoryEntries,
        });
        // 3. 发送请求
        const model = opts.model ?? ai.model;
        const requestId = (0, crypto_1.randomUUID)();
        const body = {
            model,
            max_tokens: opts.maxTokens ?? 4096,
            system: payload.cacheControl
                ? [{ type: 'text', text: payload.systemPrompt, cache_control: payload.cacheControl }]
                : payload.systemPrompt,
            messages: payload.messages,
        };
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${ai.authToken}`,
            'anthropic-version': '2023-06-01',
        };
        if (this.capability === 'native') {
            headers['anthropic-beta'] = 'prompt-caching-2024-07-31';
        }
        const res = await fetch(`${ai.baseUrl}/v1/messages`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`AI API error ${res.status}: ${errText}`);
        }
        const data = await res.json();
        const usage = data.usage ?? {};
        const inputTokens = usage.input_tokens ?? 0;
        const outputTokens = usage.output_tokens ?? 0;
        const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
        const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
        // 4. 记录使用量
        this.cache.trackUsage({
            requestId,
            model,
            provider: new URL(ai.baseUrl).hostname,
            strategy: payload.strategy,
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheWriteTokens,
            savedTokens: payload.savedTokens,
            timestamp: Date.now(),
        });
        const content = data.content?.[0]?.text ?? '';
        return {
            content,
            usage: {
                inputTokens,
                outputTokens,
                cacheReadTokens,
                cacheWriteTokens,
                savedTokens: payload.savedTokens,
            },
            strategy: payload.strategy,
            attempts: 1,
        };
    }
    /**
     * 获取 token 节省报告（可推送到 Hub）
     */
    getSavingsReport(period = 'today') {
        return this.cache.getSavingsReport(period);
    }
    // ── Tool-use support ─────────────────────────────────────────────────────────
    /** 带工具定义的单次调用，返回包含工具调用信息的完整响应 */
    async chatWithTools(messages, tools, opts = {}) {
        await this.ensureCapabilityProbed();
        const { ai } = this.config;
        const model = opts.model ?? ai.model;
        const body = {
            model,
            max_tokens: opts.maxTokens ?? 4096,
            tools,
            messages,
        };
        if (opts.systemPrompt)
            body.system = opts.systemPrompt;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${ai.authToken}`,
            'anthropic-version': '2023-06-01',
        };
        const res = await fetch(`${ai.baseUrl}/v1/messages`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`AI API error ${res.status}: ${errText}`);
        }
        const data = await res.json();
        const usage = data.usage ?? {};
        const rawContent = data.content ?? [];
        const textBlocks = rawContent.filter((b) => b.type === 'text');
        const toolUseBlocks = rawContent.filter((b) => b.type === 'tool_use');
        return {
            content: textBlocks.map((b) => b.text).join(''),
            rawContent,
            stopReason: data.stop_reason ?? 'end_turn',
            toolUses: toolUseBlocks.map((b) => ({ id: b.id, name: b.name, input: b.input })),
            usage: { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 },
            model,
        };
    }
    /** 流式输出 — AsyncGenerator，每次 yield 一个文本 delta */
    async *stream(messages, opts = {}) {
        await this.ensureCapabilityProbed();
        const { ai } = this.config;
        const model = opts.model ?? ai.model;
        const body = {
            model,
            max_tokens: opts.maxTokens ?? 4096,
            stream: true,
            messages,
        };
        if (opts.systemPrompt)
            body.system = opts.systemPrompt;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${ai.authToken}`,
            'anthropic-version': '2023-06-01',
        };
        const res = await fetch(`${ai.baseUrl}/v1/messages`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: opts.signal,
        });
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Stream AI API error ${res.status}: ${errText}`);
        }
        const reader = res.body?.getReader();
        if (!reader)
            throw new Error('No response body for streaming');
        const decoder = new TextDecoder();
        let buf = '';
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buf += decoder.decode(value, { stream: true });
                const lines = buf.split('\n');
                buf = lines.pop() ?? '';
                for (const line of lines) {
                    if (!line.startsWith('data: '))
                        continue;
                    const json = line.slice(6).trim();
                    if (json === '[DONE]')
                        return;
                    try {
                        const evt = JSON.parse(json);
                        const delta = evt?.delta?.text;
                        if (typeof delta === 'string' && delta)
                            yield delta;
                    }
                    catch {
                        // ignore malformed SSE lines
                    }
                }
            }
        }
        finally {
            reader.releaseLock();
        }
    }
    // ── OrgNorm 注入 ─────────────────────────────────────────────────────────────
    /** 从 Hub 拉取 OrgNorm 的缓存（5 分钟 TTL） */
    _normCache = null;
    NORM_TTL_MS = 5 * 60 * 1000; // 5 minutes
    /**
     * callWithNorms — 自动从 Hub 拉取当前 OrgNorm 并注入 system prompt，然后执行 AI 调用。
     * 拉取结果缓存 5 分钟，避免每次都发 HTTP 请求。
     */
    async callWithNorms(opts) {
        const inject = await this._fetchNormInject(opts.role ?? 'worker');
        const enrichedSystem = inject
            ? `${inject}\n\n${opts.systemPrompt}`
            : opts.systemPrompt;
        return this.call({ ...opts, systemPrompt: enrichedSystem });
    }
    async _fetchNormInject(role) {
        const now = Date.now();
        if (this._normCache && now - this._normCache.fetchedAt < this.NORM_TTL_MS) {
            return this._normCache.inject;
        }
        const hubUrl = this.config.hubUrl;
        try {
            const res = await fetch(`${hubUrl}/api/org-norm?role=${encodeURIComponent(role)}`, {
                headers: { 'Authorization': `Bearer ${this.config.hubToken ?? ''}` },
            });
            if (!res.ok) {
                console.warn(`[ai-client] OrgNorm fetch failed: ${res.status}`);
                return '';
            }
            const data = await res.json();
            const norms = data.norms ?? [];
            const inject = norms.length > 0
                ? `ORGANIZATION NORMS:\n${norms.map(n => `- ${n.rule}`).join('\n')}`
                : '';
            this._normCache = { inject, fetchedAt: now };
            return inject;
        }
        catch (err) {
            console.warn('[ai-client] OrgNorm fetch error:', err.message);
            return '';
        }
    }
    async ensureCapabilityProbed() {
        const { ai } = this.config;
        const now = Date.now();
        if (this.capability && now - this.lastProbeTime < ai.cacheProbeInterval)
            return;
        const result = await this.cache.detectCacheSupport(ai.baseUrl, ai.authToken, ai.model);
        this.capability = result.capability;
        this.lastProbeTime = now;
        console.log(`[ai-client] Cache capability: ${this.capability} (provider: ${result.provider})`);
        if (this.capability === 'none') {
            console.log('[ai-client] SmartCache compression active — local memory filtering enabled');
        }
    }
}
exports.AiClient = AiClient;
// 单例工厂（每个 nodeId 一个实例）
const clients = new Map();
function getAiClient(nodeId, config) {
    if (!clients.has(nodeId)) {
        clients.set(nodeId, new AiClient(nodeId, config));
    }
    return clients.get(nodeId);
}
//# sourceMappingURL=ai-client.js.map