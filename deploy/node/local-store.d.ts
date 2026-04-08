/**
 * Node Local Message Store — sql.js based
 *
 * Stores received messages locally on the Node side.
 * Three-layer store architecture:
 *   1. Hub store (hub/src/store/message-store.ts) — authoritative
 *   2. Node local store (this file) — local cache + offline access
 *   3. User query entry — CLI / API / PWA reads from here
 *
 * Path: ~/.jackclaw/node/<nodeId>/messages.db
 */
export interface LocalMessage {
    id: string;
    threadId?: string;
    from: string;
    to: string;
    type: string;
    content: string;
    status: string;
    ts: number;
    encrypted: boolean;
    metadata?: Record<string, unknown>;
}
export declare class NodeLocalStore {
    private db;
    private dbPath;
    private dirty;
    private flushTimer;
    private ready;
    constructor(nodeId: string);
    init(): Promise<boolean>;
    /** Save a received message to local store */
    save(msg: LocalMessage): void;
    /** Get a message by ID */
    get(id: string): LocalMessage | null;
    /** Get recent messages */
    recent(limit?: number): LocalMessage[];
    /** Get inbox (messages sent to this node) */
    inbox(toId: string, limit?: number): LocalMessage[];
    /** Get thread messages */
    thread(threadId: string, limit?: number): LocalMessage[];
    /** Stats */
    stats(): {
        total: number;
        threads: number;
    };
    /** Flush to disk */
    flush(): void;
    /** Close store */
    close(): void;
    private _rowToMsg;
}
//# sourceMappingURL=local-store.d.ts.map