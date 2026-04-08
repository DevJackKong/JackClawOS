/**
 * JackClaw AI Client — SmartCache 原生集成
 *
 * 所有 LLM 调用统一走这里。自动：
 * 1. 探测中转站缓存能力（首次 + 每24h）
 * 2. 按能力选择最优 payload 策略（native/compressed/sliding）
 * 3. 记录 token 使用 + 统计节省量
 */
import type { JackClawConfig } from './config';
import { type Message } from './smart-cache';
export interface MemoryEntry {
    type: 'user' | 'feedback' | 'project' | 'reference';
    content: string;
    tags?: string[];
}
export interface AiCallOptions {
    systemPrompt: string;
    memoryEntries?: MemoryEntry[];
    messages: Message[];
    queryContext?: string;
    maxTokens?: number;
    model?: string;
    retry?: {
        enabled?: boolean;
        maxAttempts?: number;
        successEvaluator?: (response: string) => boolean;
        contextExtractor?: () => string;
    };
}
export interface AiCallResult {
    content: string;
    usage: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
        savedTokens: number;
    };
    strategy: string;
    attempts: number;
    retryHistory?: Array<{
        attempt: number;
        failureType: string;
        summary: string;
    }>;
}
export declare class AiClient {
    private nodeId;
    private config;
    private cache;
    private capability;
    private lastProbeTime;
    constructor(nodeId: string, config: JackClawConfig);
    call(opts: AiCallOptions): Promise<AiCallResult>;
    /** 单次 API 调用（不含重试逻辑） */
    private _singleCall;
    /**
     * 获取 token 节省报告（可推送到 Hub）
     */
    getSavingsReport(period?: 'today' | '7d' | '30d' | 'all'): import("./smart-cache").TokenSavingsReport;
    /** 带工具定义的单次调用，返回包含工具调用信息的完整响应 */
    chatWithTools(messages: Message[], tools: Array<{
        name: string;
        description: string;
        input_schema: unknown;
    }>, opts?: {
        systemPrompt?: string;
        model?: string;
        maxTokens?: number;
    }): Promise<{
        content: string;
        rawContent: unknown;
        stopReason: string;
        toolUses: Array<{
            id: string;
            name: string;
            input: unknown;
        }>;
        usage: {
            inputTokens: number;
            outputTokens: number;
        };
        model: string;
    }>;
    /** 流式输出 — AsyncGenerator，每次 yield 一个文本 delta */
    stream(messages: Message[], opts?: {
        systemPrompt?: string;
        model?: string;
        maxTokens?: number;
        signal?: AbortSignal;
    }): AsyncGenerator<string>;
    /** 从 Hub 拉取 OrgNorm 的缓存（5 分钟 TTL） */
    private _normCache;
    private readonly NORM_TTL_MS;
    /**
     * callWithNorms — 自动从 Hub 拉取当前 OrgNorm 并注入 system prompt，然后执行 AI 调用。
     * 拉取结果缓存 5 分钟，避免每次都发 HTTP 请求。
     */
    callWithNorms(opts: AiCallOptions & {
        role?: string;
    }): Promise<AiCallResult>;
    private _fetchNormInject;
    private ensureCapabilityProbed;
}
export declare function getAiClient(nodeId: string, config: JackClawConfig): AiClient;
//# sourceMappingURL=ai-client.d.ts.map