/**
 * JackClaw Hub - Unified Offline Queue (WAL-based)
 *
 * Persists queued messages for offline handles.
 * Keyed by target @handle (not nodeId) so messages survive node ID changes.
 *
 * Storage strategy:
 *   - Write-Ahead Log (WAL): appendFileSync for every enqueue/dequeue op
 *   - Periodic compaction: rebuild full state file from WAL
 *   - Atomic rename on compaction: crash-safe
 *
 * Each enqueued item is a { event, data } envelope ready to be sent over WS.
 */
export interface QueuedEnvelope {
    event: string;
    data: unknown;
}
declare class OfflineQueue {
    private queue;
    private walCount;
    private compactTimer;
    constructor();
    /** Add a message to the offline queue for a target handle. */
    enqueue(targetHandle: string, message: QueuedEnvelope): void;
    /** Drain (remove and return) all queued messages for a handle. */
    dequeue(targetHandle: string): QueuedEnvelope[];
    /** Count pending messages without consuming them. */
    peek(targetHandle: string): number;
    /** Total queued messages across all handles. */
    totalPending(): number;
    private _key;
    private _appendWal;
    private _replayWal;
    private _compact;
    private _writeSnapshot;
    private _loadSnapshot;
}
export declare const offlineQueue: OfflineQueue;
export {};
//# sourceMappingURL=offline-queue.d.ts.map