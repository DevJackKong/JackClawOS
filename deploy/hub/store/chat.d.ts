/**
 * ClawChat Hub Store — 消息存储、离线队列、会话管理
 */
export interface ChatGroup {
    groupId: string;
    name: string;
    members: string[];
    createdBy: string;
    createdAt: number;
    topic?: string;
}
export type ChatMessageType = 'human' | 'task' | 'ask' | 'broadcast' | 'reply' | 'ack' | 'plan-result' | 'card' | 'transaction' | 'media' | 'reminder' | 'calendar' | 'approval' | 'iot' | 'health' | 'location' | 'system' | `x-${string}`;
export interface ChatMessage {
    id: string;
    threadId?: string;
    replyToId?: string;
    from: string;
    to: string | string[];
    type: ChatMessageType;
    content: string;
    attachments?: Array<{
        name: string;
        type: 'file' | 'image' | 'memory-ref' | 'task-result';
        url?: string;
        data?: string;
        memoryKey?: string;
    }>;
    ts: number;
    signature: string;
    encrypted: boolean;
    read?: boolean;
    readBy?: string[];
    recalled?: boolean;
    recalledAt?: number;
    metadata?: Record<string, unknown>;
    executionResult?: {
        status: 'success' | 'failed' | 'pending-review';
        output: string;
        attempts: number;
    };
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
    private groups;
    private messageRead;
    private activityLog;
    getMessage(id: string): ChatMessage | undefined;
    saveMessage(msg: ChatMessage): void;
    recallMessage(id: string, recalledAt?: number): ChatMessage | null;
    getThread(threadId: string): ChatMessage[];
    getInbox(nodeId: string): ChatMessage[];
    queueForOffline(nodeId: string, msg: ChatMessage): void;
    drainInbox(nodeId: string): ChatMessage[];
    createThread(participants: string[], title?: string): ChatThread;
    listThreads(nodeId: string): ChatThread[];
    markMessageRead(messageId: string, readBy: string): ChatMessage | undefined;
    getMessageReaders(messageId: string): string[];
    /** Hub 侧轻量观察：记录活跃时间戳，供 Node 侧 OwnerMemory 消费 */
    observeMessage(nodeId: string, opts: {
        content: string;
        direction: string;
        type: string;
    }): void;
    getActivityLog(nodeId: string): number[];
    createGroup(name: string, members: string[], createdBy: string, topic?: string): ChatGroup;
    getGroup(groupId: string): ChatGroup | null;
    listGroups(nodeId: string): ChatGroup[];
    private withReadState;
}
//# sourceMappingURL=chat.d.ts.map