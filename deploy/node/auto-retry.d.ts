/**
 * JackClaw Auto-Retry Loop — 让 AI 自主解决问题，无需人工多轮沟通
 *
 * 核心思想：AI 第一次拒绝/模糊≠真的不能解决。
 * 自动分类失败原因，重构 prompt，最多重试 N 轮，收敛最佳结果。
 */
import type { AiClient, AiCallOptions } from './ai-client';
export type FailureType = 'soft-uncertainty' | 'soft-incomplete' | 'soft-context' | 'hard-capability' | 'hard-policy' | 'success';
export interface RetryResult {
    content: string;
    attempts: number;
    failureHistory: Array<{
        attempt: number;
        failureType: FailureType;
        summary: string;
    }>;
    finalStrategy: string;
    totalTokens: number;
    totalSavedTokens: number;
}
export declare function classifyResponse(response: string): FailureType;
export declare function rewritePrompt(originalMessages: AiCallOptions['messages'], failureType: FailureType, failedResponse: string, attempt: number, contextHints?: string): AiCallOptions['messages'];
export interface RetryConfig {
    maxAttempts?: number;
    successEvaluator?: (response: string) => boolean;
    contextExtractor?: () => string;
}
export declare function autoRetry(aiClient: AiClient, opts: AiCallOptions, retryConfig?: RetryConfig): Promise<RetryResult>;
//# sourceMappingURL=auto-retry.d.ts.map