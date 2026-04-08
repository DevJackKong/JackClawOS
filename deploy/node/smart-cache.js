"use strict";
/**
 * JackClaw SmartCache — API 缓存感知 + Token 最小化引擎
 *
 * 问题：中转站（road2all/one-api等）大多不支持 Anthropic prompt caching，
 *       导致每次调用都重发完整 system prompt + memory，浪费大量 token。
 *
 * 解决：自动探测中转站缓存能力，不支持时启用本地增量压缩策略。
 */
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SmartCache = void 0;
exports.getSmartCache = getSmartCache;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
// ─── SmartCache 核心实现 ─────────────────────────────────────────────────────
class SmartCache {
    nodeId;
    baseDir;
    cacheDir;
    probeCache = new Map();
    contentHashCache = new Map(); // hash → compressed content
    usageLog = [];
    constructor(nodeId, baseDir = path.join(os.homedir(), '.jackclaw')) {
        this.nodeId = nodeId;
        this.baseDir = baseDir;
        this.cacheDir = path.join(baseDir, 'smart-cache', nodeId);
        fs.mkdirSync(this.cacheDir, { recursive: true });
        this.loadProbeCache();
        this.loadUsageLog();
    }
    /**
     * 探测中转站是否支持 Anthropic prompt caching
     * 发送一个带 cache_control 的测试请求，检查响应头
     */
    async detectCacheSupport(baseUrl, authToken, model) {
        const cacheKey = `${baseUrl}:${model}`;
        // 如果24小时内已探测过，直接返回缓存结果
        const cached = this.probeCache.get(cacheKey);
        if (cached && Date.now() - cached.detectedAt < 24 * 60 * 60 * 1000) {
            return cached;
        }
        const testSystemPrompt = 'You are a helpful assistant. ' + 'x'.repeat(1024); // 需要足够长才能触发缓存
        try {
            const response = await fetch(`${baseUrl}/v1/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`,
                    'anthropic-version': '2023-06-01',
                    'anthropic-beta': 'prompt-caching-2024-07-31',
                },
                body: JSON.stringify({
                    model,
                    max_tokens: 10,
                    system: [{ type: 'text', text: testSystemPrompt, cache_control: { type: 'ephemeral' } }],
                    messages: [{ role: 'user', content: 'Hi' }],
                }),
            });
            const data = await response.json();
            const usage = data.usage ?? {};
            const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
            const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
            // 如果有写入缓存的 token，说明支持 native caching
            let capability = 'none';
            if (cacheWriteTokens > 0) {
                capability = 'native';
            }
            else if (response.headers.get('anthropic-cache-read-input-tokens') !== null) {
                capability = 'partial';
            }
            const result = {
                provider: new URL(baseUrl).hostname,
                baseUrl,
                capability,
                detectedAt: Date.now(),
                cacheReadTokens,
                cacheWriteTokens,
            };
            this.probeCache.set(cacheKey, result);
            this.saveProbeCache();
            return result;
        }
        catch {
            // 探测失败，假设不支持
            const result = {
                provider: new URL(baseUrl).hostname,
                baseUrl,
                capability: 'none',
                detectedAt: Date.now(),
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
            };
            this.probeCache.set(cacheKey, result);
            return result;
        }
    }
    /**
     * 根据缓存能力，构建最优的请求 payload
     */
    buildOptimalPayload(opts) {
        const { systemPrompt, memoryEntries, messages, queryContext, capability, maxMemoryEntries = 20 } = opts;
        if (capability === 'native') {
            // 原生缓存：添加 cache_control 标记，完整发送
            return this.buildNativePayload(systemPrompt, memoryEntries, messages);
        }
        // 本地优化策略：压缩 memory + 增量消息
        const relevantMemory = this.filterRelevantMemory(memoryEntries, queryContext, maxMemoryEntries);
        const compressedSystem = this.buildCompressedSystem(systemPrompt, relevantMemory);
        const fullSize = this.estimateTokens(systemPrompt) +
            memoryEntries.reduce((s, e) => s + this.estimateTokens(e.content), 0);
        const compressedSize = this.estimateTokens(compressedSystem);
        const savedTokens = Math.max(0, fullSize - compressedSize);
        // 如果对话很长，使用滑动窗口
        const strategy = messages.length > 20 ? 'sliding' : savedTokens > 0 ? 'compressed' : 'full';
        const finalMessages = strategy === 'sliding'
            ? this.applySlideWindow(messages, 20)
            : messages;
        return {
            systemPrompt: compressedSystem,
            messages: finalMessages,
            strategy,
            estimatedTokens: compressedSize + finalMessages.reduce((s, m) => s + this.estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)), 0),
            savedTokens,
        };
    }
    /**
     * 记录 token 使用情况
     */
    trackUsage(record) {
        this.usageLog.push({ ...record, nodeId: this.nodeId });
        // 只保留最近1000条
        if (this.usageLog.length > 1000) {
            this.usageLog = this.usageLog.slice(-1000);
        }
        this.saveUsageLog();
    }
    /**
     * 生成 token 节省报告
     */
    getSavingsReport(period = 'today') {
        const now = Date.now();
        const cutoff = period === 'today' ? now - 86400000
            : period === '7d' ? now - 7 * 86400000
                : period === '30d' ? now - 30 * 86400000
                    : 0;
        const records = this.usageLog.filter(r => r.timestamp >= cutoff);
        const totalInput = records.reduce((s, r) => s + r.inputTokens, 0);
        const totalCacheRead = records.reduce((s, r) => s + r.cacheReadTokens, 0);
        const totalSaved = records.reduce((s, r) => s + r.savedTokens, 0);
        const savingsRate = totalInput > 0 ? totalSaved / (totalInput + totalSaved) : 0;
        // claude-opus-4 输入 $15/M tokens
        const estimatedCostSaved = totalSaved * 0.000015;
        const byStrategy = {
            full: 0, incremental: 0, compressed: 0, sliding: 0,
        };
        for (const r of records) {
            byStrategy[r.strategy] = (byStrategy[r.strategy] ?? 0) + r.savedTokens;
        }
        return {
            nodeId: this.nodeId,
            period,
            totalRequests: records.length,
            totalInputTokens: totalInput,
            totalCacheReadTokens: totalCacheRead,
            totalSavedTokens: totalSaved,
            savingsRate,
            estimatedCostSaved,
            byStrategy,
        };
    }
    // ─── 私有方法 ─────────────────────────────────────────────────────────────
    buildNativePayload(systemPrompt, memoryEntries, messages) {
        const memoryText = memoryEntries.map(e => `[${e.type}] ${e.content}`).join('\n');
        const fullSystem = `${systemPrompt}\n\n## Memory\n${memoryText}`;
        return {
            systemPrompt: fullSystem,
            messages,
            strategy: 'full',
            estimatedTokens: this.estimateTokens(fullSystem),
            savedTokens: 0,
            cacheControl: { type: 'ephemeral' },
        };
    }
    filterRelevantMemory(entries, queryContext, maxEntries = 20) {
        if (!queryContext || entries.length <= maxEntries)
            return entries.slice(0, maxEntries);
        // 简单关键词匹配打分
        const queryWords = queryContext.toLowerCase().split(/\s+/);
        const scored = entries.map(e => {
            const text = (e.content + ' ' + (e.tags ?? []).join(' ')).toLowerCase();
            const score = queryWords.filter(w => text.includes(w)).length;
            return { entry: e, score };
        });
        return scored
            .sort((a, b) => b.score - a.score)
            .slice(0, maxEntries)
            .map(s => s.entry);
    }
    buildCompressedSystem(systemPrompt, relevantMemory) {
        const memText = relevantMemory
            .map(e => `[${e.type}] ${e.content}`)
            .join('\n');
        return memText ? `${systemPrompt}\n\n## Relevant Memory\n${memText}` : systemPrompt;
    }
    applySlideWindow(messages, windowSize) {
        if (messages.length <= windowSize)
            return messages;
        // 保留第一条（通常是系统上下文）+ 最近 N-1 条
        return [messages[0], ...messages.slice(-(windowSize - 1))];
    }
    estimateTokens(text) {
        // 粗略估算：1 token ≈ 4 字符（英文）≈ 2 汉字
        return Math.ceil(text.length / 3);
    }
    loadProbeCache() {
        const file = path.join(this.cacheDir, 'probe-cache.json');
        try {
            const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
            for (const [k, v] of Object.entries(data)) {
                this.probeCache.set(k, v);
            }
        }
        catch { /* 首次运行 */ }
    }
    saveProbeCache() {
        const file = path.join(this.cacheDir, 'probe-cache.json');
        const data = Object.fromEntries(this.probeCache);
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    }
    loadUsageLog() {
        const file = path.join(this.cacheDir, 'usage.jsonl');
        try {
            const lines = fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean);
            this.usageLog = lines.map(l => JSON.parse(l));
        }
        catch { /* 首次运行 */ }
    }
    saveUsageLog() {
        const file = path.join(this.cacheDir, 'usage.jsonl');
        const lines = this.usageLog.map(r => JSON.stringify(r)).join('\n');
        fs.writeFileSync(file, lines + '\n');
    }
}
exports.SmartCache = SmartCache;
// 单例工厂
const instances = new Map();
function getSmartCache(nodeId) {
    if (!instances.has(nodeId)) {
        instances.set(nodeId, new SmartCache(nodeId));
    }
    return instances.get(nodeId);
}
//# sourceMappingURL=smart-cache.js.map