export type ChatMessageHandler = (msg: {
    id: string;
    from: string;
    to: string;
    content: string;
    type: string;
}) => void;
export declare class NodeChatClient {
    private nodeId;
    private hubUrl;
    private ws;
    private reconnectCount;
    private connected;
    private handlers;
    private stopped;
    private offlineQueue;
    private pendingAcks;
    constructor(nodeId: string, hubUrl: string);
    onMessage(handler: ChatMessageHandler): void;
    isConnected(): boolean;
    connect(): void;
    /**
     * 发送消息，带 ACK 等待 + 超时重试。
     * 断线时自动加入离线队列，重连后补发。
     */
    send(to: string, content: string, type?: string): void;
    /** 内部发送：断开则入队；否则发送并注册 ACK 等待 */
    private _rawSend;
    /** 注册 ACK 等待，超时后重试 */
    private _registerAck;
    /** 收到 ACK 后清除等待定时器 */
    private _clearAck;
    stop(): void;
}
//# sourceMappingURL=chat-client.d.ts.map