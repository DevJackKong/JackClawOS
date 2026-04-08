/**
 * AI Message Filter — rules-based engine (no LLM dependency)
 *
 * Config: ~/.jackclaw/node/filter.json
 * Log:    ~/.jackclaw/node/filter-log.jsonl
 */
import type { SocialMessage } from '@jackclaw/protocol';
export type FilterAction = 'allow' | 'flag' | 'block';
export interface FilterResult {
    action: FilterAction;
    reason: string;
    confidence: number;
}
interface KeywordRule {
    word: string;
    action: 'flag' | 'block';
}
interface FilterConfig {
    whitelist: string[];
    blacklist: string[];
    keywords: KeywordRule[];
}
export interface FilterLogEntry {
    ts: number;
    messageId: string;
    fromAgent: string;
    action: FilterAction;
    reason: string;
    contentPreview: string;
}
export interface DailyStats {
    date: string;
    allowed: number;
    flagged: number;
    blocked: number;
    total: number;
}
export declare class MessageFilter {
    private config;
    private readonly rateBucket;
    private readonly recentContent;
    private stats;
    constructor();
    /** Analyse an incoming social message and decide what to do with it. */
    analyze(msg: SocialMessage): FilterResult;
    addToWhitelist(handle: string): void;
    removeFromWhitelist(handle: string): void;
    addToBlacklist(handle: string): void;
    removeFromBlacklist(handle: string): void;
    addKeyword(word: string, action: 'flag' | 'block'): void;
    removeKeyword(word: string): void;
    /** Today's in-memory filter statistics. */
    getStats(): DailyStats;
    /**
     * Return all log entries where action === 'block' or 'flag',
     * sorted newest first, limited to today.
     */
    getBlocked(): FilterLogEntry[];
    getConfig(): FilterConfig;
    private _record;
    private _appendLog;
    private _inList;
    private _norm;
    private _today;
    private _resetIfNewDay;
    private _loadConfig;
    private _saveConfig;
}
export {};
//# sourceMappingURL=ai-filter.d.ts.map