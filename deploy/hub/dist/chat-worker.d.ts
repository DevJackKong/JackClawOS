/**
 * ChatWorker — isolated chat processing with priority queue
 *
 * Owns the WebSocket connection pool and message delivery pipeline.
 * All IO is async/non-blocking. Never awaits LLM calls.
 *
 * Message priority (lower value = higher priority):
 *   0 → human   (direct human↔agent messages)
 *   1 → task    (task dispatch messages)
 *   2 → system  (everything else)
 */
import { WebSocketServer, WebSocket } from 'ws';
import { ChatStore, ChatMessage } from './store/chat';
import type { MessageStatus, StatusTransition } from '@jackclaw/protocol';
export declare function getMessageTrace(messageId: string): StatusTransition[];
export declare function getMessageStatus(messageId: string): MessageStatus | null;
export declare class ChatWorker {
    readonly store: ChatStore;
    private wsClients;
    private wsAlive;
    private heartbeatTimer;
    private queue;
    private seq;
    private draining;
    private _ackTimers;
    private readonly ACK_TIMEOUT;
    private readonly RETRY_DELAY;
    private _recentIds;
    private readonly DEDUPE_TTL;
    private _dedupeTimer;
    private overflowFile;
    private overflowActive;
    private totalReceived;
    private totalDelivered;
    private totalQueued;
    private latencySamples;
    constructor(store?: ChatStore);
    private _startDedupeCleanup;
    /**
     * Accept an incoming message, expand group targets, and enqueue for delivery.
     * Saves to store immediately; delivery happens asynchronously.
     */
    handleIncoming(msg: ChatMessage): void;
    /**
     * Deliver a single message to target.
     * WebSocket if online; offline queue otherwise.
     * Human targets are routed via agentNodeId or direct webhook.
     */
    deliver(target: string, msg: ChatMessage): void;
    /** Retry delivery once, then queue offline */
    private _retryDeliver;
    /** Start ACK timeout — if no delivery_ack within 3s, queue offline */
    private _startAckTimer;
    /** Called when we receive a delivery_ack from a node */
    handleDeliveryAck(messageId: string, nodeId: string): void;
    /** Queue message offline with push notification */
    private _queueOffline;
    /**
     * Enqueue delivery to multiple targets at the same priority.
     */
    broadcast(targets: string[], msg: ChatMessage): void;
    /**
     * Push an arbitrary event to a connected node's WebSocket.
     * Returns false if node is offline (caller handles queueing).
     */
    pushEvent(nodeId: string, event: string, data: unknown): boolean;
    /** Raw WebSocket access (for social route offline queueing) */
    getClientWs(nodeId: string): WebSocket | undefined;
    getStats(): {
        connections: number;
        queueDepth: number;
        overflowActive: boolean;
        totalReceived: number;
        totalDelivered: number;
        totalQueued: number;
        avgLatencyMs: number;
    };
    attachWss(server: import('http').Server): WebSocketServer;
    private _enqueue;
    /** Binary-search insert to maintain priority-ascending (FIFO within same priority) order */
    private _insertSorted;
    private _drain;
    private _spillToDisk;
    private _reloadFromDisk;
    private _startHeartbeat;
    private _triggerPlanner;
    private _deliverToHuman;
}
export declare const chatWorker: ChatWorker;
//# sourceMappingURL=chat-worker.d.ts.map