/**
 * JackClaw SmartCache — API 缓存感知 + Token 最小化引擎
 *
 * 问题：中转站（road2all/one-api等）大多不支持 Anthropic prompt caching，
 *       导致每次调用都重发完整 system prompt + memory，浪费大量 token。
 *
 * 解决：自动探测中转站缓存能力，不支持时启用本地增量压缩策略。
 */
export type CacheCapability = 'native' | 'partial' | 'none';
export interface CacheProbeResult {
    provider: string;
    baseUrl: string;
    capability: CacheCapability;
    detectedAt: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
}
export type OptimizationStrategy = 'full' | 'incremental' | 'compressed' | 'sliding';
export interface OptimizedPayload {
    systemPrompt: string;
    messages: Message[];
    strategy: OptimizationStrategy;
    estimatedTokens: number;
    savedTokens: number;
    cacheControl?: unknown;
}
export interface Message {
    role: 'user' | 'assistant';
    content: string | ContentBlock[];
}
export interface ContentBlock {
    type: 'text';
    text: string;
    cache_control?: {
        type: 'ephemeral';
    };
}
export interface TokenUsageRecord {
    requestId: string;
    nodeId: string;
    model: string;
    provider: string;
    strategy: OptimizationStrategy;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    savedTokens: number;
    timestamp: number;
}
export interface TokenSavingsReport {
    nodeId: string;
    period: 'today' | '7d' | '30d' | 'all';
    totalRequests: number;
    totalInputTokens: number;
    totalCacheReadTokens: number;
    totalSavedTokens: number;
    savingsRate: number;
    estimatedCostSaved: number;
    byStrategy: Record<OptimizationStrategy, number>;
}
export declare class SmartCache {
    private nodeId;
    private baseDir;
    private cacheDir;
    private probeCache;
    private contentHashCache;
    private usageLog;
    constructor(nodeId: string, baseDir?: string);
    /**
     * 探测中转站是否支持 Anthropic prompt caching
     * 发送一个带 cache_control 的测试请求，检查响应头
     */
    detectCacheSupport(baseUrl: string, authToken: string, model: string): Promise<CacheProbeResult>;
    /**
     * 根据缓存能力，构建最优的请求 payload
     */
    buildOptimalPayload(opts: {
        systemPrompt: string;
        memoryEntries: Array<{
            type: string;
            content: string;
            tags?: string[];
        }>;
        messages: Message[];
        queryContext?: string;
        capability: CacheCapability;
        maxMemoryEntries?: number;
    }): OptimizedPayload;
    /**
     * 记录 token 使用情况
     */
    trackUsage(record: Omit<TokenUsageRecord, 'nodeId'>): void;
    /**
     * 生成 token 节省报告
     */
    getSavingsReport(period?: TokenSavingsReport['period']): TokenSavingsReport;
    private buildNativePayload;
    private filterRelevantMemory;
    private buildCompressedSystem;
    private applySlideWindow;
    private estimateTokens;
    private loadProbeCache;
    private saveProbeCache;
    private loadUsageLog;
    private saveUsageLog;
}
export declare function getSmartCache(nodeId: string): SmartCache;
//# sourceMappingURL=smart-cache.d.ts.map