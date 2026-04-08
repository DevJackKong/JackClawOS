/**
 * ClawChat — JackClaw 原生消息通道
 *
 * 人↔Agent↔人 的 IM 系统，内置于 JackClaw 网络。
 * 消息即指令：type='task' 直接触发 Agent 执行。
 * E2E 加密，离线队列，WebSocket 实时推送。
 */
import type { NodeIdentity } from '@jackclaw/protocol';
export type ChatMessageType = 'human' | 'task' | 'ask' | 'broadcast' | 'reply' | 'ack';
export interface ChatMessage {
    id: string;
    threadId?: string;
    replyToId?: string;
    from: string;
    to: string | string[];
    type: ChatMessageType;
    content: string;
    attachments?: ChatAttachment[];
    ts: number;
    signature: string;
    encrypted: boolean;
    read?: boolean;
    executionResult?: {
        status: 'success' | 'failed' | 'pending-review';
        output: string;
        attempts: number;
    };
}
export interface ChatAttachment {
    name: string;
    type: 'file' | 'image' | 'memory-ref' | 'task-result';
    url?: string;
    data?: string;
    memoryKey?: string;
}
export interface ChatThread {
    id: string;
    participants: string[];
    title?: string;
    createdAt: number;
    lastMessageAt: number;
    messageCount: number;
}
export declare class ChatStore {
    private messages;
    private threads;
    private inbox;
    saveMessage(msg: ChatMessage): void;
    getThread(threadId: string): ChatMessage[];
    getInbox(nodeId: string): ChatMessage[];
    queueForOffline(nodeId: string, msg: ChatMessage): void;
    drainInbox(nodeId: string): ChatMessage[];
    createThread(participants: string[], title?: string): ChatThread;
    listThreads(nodeId: string): ChatThread[];
}
export declare function buildChatMessage(opts: {
    from: string;
    to: string | string[];
    type: ChatMessageType;
    content: string;
    threadId?: string;
    replyToId?: string;
    attachments?: ChatAttachment[];
    identity: NodeIdentity;
    recipientPublicKey?: string;
}): ChatMessage;
export declare function decryptChatMessage(msg: ChatMessage, recipientPrivateKey: string): string;
export declare function verifyChatMessage(msg: ChatMessage, senderPublicKey: string): boolean;
//# sourceMappingURL=chat.d.ts.map