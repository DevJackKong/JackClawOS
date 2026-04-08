/**
 * Context Store — LLM-aware conversation context management
 *
 * Core principle: messages route through WebSocket at ZERO token cost.
 * Only when AI processing is needed, the Context Store provides:
 *   1. Recent K messages (not full history)
 *   2. Auto-compressed summaries for older context
 *   3. Model-independent storage (switch models without losing context)
 *
 * Token savings:
 *   - Regular routing: 0 tokens (pure WebSocket)
 *   - AI processing: summary + recent K = ~80% less than full history
 *   - Model switch: rebuild from store, not resend
 */
interface ContextEntry {
    role: 'user' | 'assistant' | 'system';
    content: string;
    ts: number;
    messageId?: string;
    tokenEstimate: number;
}
export declare class ContextStore {
    private contexts;
    private readonly maxEntriesBeforeSummary;
    private readonly maxRecentEntries;
    private readonly maxTokensPerContext;
    constructor(opts?: {
        maxEntriesBeforeSummary?: number;
        maxRecentEntries?: number;
        maxTokensPerContext?: number;
    });
    /**
     * Add a message to the context.
     * Returns true if a summary should be triggered.
     */
    addMessage(threadId: string, role: 'user' | 'assistant' | 'system', content: string, messageId?: string): boolean;
    /**
     * Get context for LLM call.
     * Returns: [summary (if exists)] + [recent K messages]
     * This is what gets sent to the model — NOT the full history.
     */
    getContextForLLM(threadId: string): ContextEntry[];
    /**
     * Get estimated token count for the current context window.
     */
    getTokenEstimate(threadId: string): number;
    /**
     * Apply a summary to compress old messages.
     * Called after LLM generates a summary of older entries.
     * Removes summarized entries, keeps only recent K.
     */
    applySummary(threadId: string, summary: string): void;
    /**
     * Get full raw entries (for debugging / export).
     */
    getRawEntries(threadId: string): ContextEntry[];
    /**
     * Get stats for a thread.
     */
    getStats(threadId: string): {
        totalMessages: number;
        currentEntries: number;
        hasSummary: boolean;
        estimatedTokens: number;
    } | null;
    /**
     * Clear context for a thread.
     */
    clear(threadId: string): void;
    /**
     * Global stats.
     */
    globalStats(): {
        activeThreads: number;
        totalEntries: number;
        totalTokens: number;
    };
}
/** Singleton Context Store */
export declare const contextStore: ContextStore;
export {};
//# sourceMappingURL=context-store.d.ts.map