/**
 * AiSecretary — AI 秘书
 *
 * 功能：自动回复、消息优先级分类、未读摘要、每日通信汇报
 * 配置：~/.jackclaw/node/secretary.json
 */
import type { AiClient } from './ai-client';
import type { OwnerMemory } from './owner-memory';
export type SecretaryMode = 'online' | 'busy' | 'away' | 'dnd';
export type Priority = 'urgent' | 'normal' | 'low' | 'spam';
export interface IncomingMsg {
    id: string;
    from: string;
    content: string;
    type?: string;
    ts: number;
}
export interface PendingMessage {
    msg: IncomingMsg;
    priority: Priority;
    receivedAt: number;
    autoReplied: boolean;
}
export interface DailySummary {
    date: string;
    totalReceived: number;
    urgent: number;
    autoReplied: number;
    pendingCount: number;
    topSenders: Array<{
        from: string;
        count: number;
    }>;
}
interface SecretaryConfig {
    mode: SecretaryMode;
    trustedContacts: string[];
    blockedContacts: string[];
    customAutoReply?: string;
    updatedAt: number;
}
export declare class AiSecretary {
    private config;
    private pending;
    private stats;
    private readonly notifyOwner;
    private readonly sendReply;
    private readonly aiClient;
    private readonly ownerMemory;
    constructor(opts?: {
        notifyOwner?: (msg: IncomingMsg, priority: Priority) => void;
        sendReply?: (to: string, content: string) => Promise<void>;
        aiClient?: AiClient;
        ownerMemory?: OwnerMemory;
    });
    setMode(mode: SecretaryMode): void;
    getMode(): SecretaryMode;
    setCustomAutoReply(text: string): void;
    getConfig(): Readonly<SecretaryConfig>;
    getPending(): PendingMessage[];
    clearPending(): void;
    handleIncoming(msg: IncomingMsg): Promise<void>;
    generateAutoReply(msg: IncomingMsg, _context: string): Promise<string>;
    summarizeUnread(messages: IncomingMsg[]): Promise<string>;
    /**
     * 规则引擎优先级分类 — 不依赖 LLM，快速响应
     */
    classifyPriority(msg: IncomingMsg): Priority;
    getDailySummary(): DailySummary;
    private enqueue;
    private recordStat;
    private todayKey;
    private ensureDir;
    private loadConfig;
    private saveConfig;
    private loadPending;
    private savePending;
    private loadStats;
    private saveStats;
}
export {};
//# sourceMappingURL=ai-secretary.d.ts.map