/**
 * MessageStore — SQLite-backed persistent message storage with FTS5 full-text search.
 * Falls back to JSONL append file if better-sqlite3 is unavailable.
 *
 * DB path: ~/.jackclaw/hub/messages.db
 */
export declare const DB_PATH: string;
export interface StoredMessage {
    id: string;
    threadId?: string;
    fromAgent: string;
    toAgent: string;
    fromHuman?: string;
    content: string;
    type: string;
    replyTo?: string;
    attachments?: unknown;
    status: string;
    ts: number;
    encrypted: boolean;
    recalled?: boolean;
    recalledAt?: number;
}
export interface SearchOptions {
    from?: string;
    to?: string;
    after?: number;
    before?: number;
    limit?: number;
    offset?: number;
}
export declare class MessageStore {
    private backend;
    private constructor();
    /**
     * Create a MessageStore.
     * Respects HUB_STORE env var: 'jsonl' forces JSONL; anything else (default: 'sqlite') tries sql.js.
     */
    static create(dbPath?: string): Promise<MessageStore>;
    /** Synchronous fallback constructor for backward compat. Uses JSONL. */
    static createSync(dbPath?: string): MessageStore;
    saveMessage(msg: StoredMessage): void;
    getMessage(id: string): StoredMessage | null;
    getThread(t: string, l?: number, o?: number): StoredMessage[];
    getInbox(h: string, l?: number, o?: number): StoredMessage[];
    markMessageRecalled(id: string, recalledAt: number): StoredMessage | null;
    deleteMessage(id: string): void;
    getStats(): {
        totalMessages: number;
        totalThreads: number;
    };
    getMessagesByParticipant(h: string, l?: number, o?: number): StoredMessage[];
    searchMessages(query: string, opts?: SearchOptions): StoredMessage[];
}
/**
 * Singleton — starts with JSONL, then upgrades to the env-selected backend.
 * HUB_STORE=sqlite (default): upgrades to sql.js when ready.
 * HUB_STORE=jsonl: stays on JSONL.
 */
export declare let messageStore: MessageStore;
//# sourceMappingURL=message-store.d.ts.map