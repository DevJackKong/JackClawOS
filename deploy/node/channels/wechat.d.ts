/**
 * wechat.ts — WeChat Work (企业微信) channel adapter for ClawChat bridge
 *
 * Supports:
 *  - Active message sending via WeChat Work API
 *  - Passive webhook callback reception (recommended)
 *  - Polling fallback mode (if no webhook endpoint available)
 *  - access_token auto-refresh (TTL 7200s)
 *  - Message signature verification (SHA1)
 *  - AES-256-CBC message decryption (WXBizMsgCrypt protocol)
 */
import { Channel, ChannelConfig, IncomingMessage, MessageContent, ChannelStatus } from './channel';
export declare class WeChatChannel implements Channel {
    readonly name = "wechat";
    private cfg;
    private tokenCache;
    private handler;
    private server;
    private pollTimer;
    private connectedAt;
    private messagesSent;
    private messagesReceived;
    connect(config: ChannelConfig): Promise<void>;
    disconnect(): Promise<void>;
    sendMessage(target: string, content: MessageContent): Promise<void>;
    onMessage(handler: (msg: IncomingMessage) => void): void;
    isConnected(): boolean;
    getStatus(): ChannelStatus;
    private getAccessToken;
    private startWebhookServer;
    private parseIncomingXml;
}
//# sourceMappingURL=wechat.d.ts.map