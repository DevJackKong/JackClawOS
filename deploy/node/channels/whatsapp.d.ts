/**
 * whatsapp.ts — WhatsApp Business Cloud API channel adapter for ClawChat bridge
 *
 * Uses Node.js native fetch (Node 18+) + built-in http module for webhook.
 * No npm dependencies required.
 *
 * Webhook verification:  GET  <webhookPath>?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
 * Incoming messages:     POST <webhookPath>  (WhatsApp Cloud API webhook payload)
 * Outgoing messages:     POST https://graph.facebook.com/v19.0/{phoneNumberId}/messages
 */
import { Channel, ChannelConfig, IncomingMessage, MessageContent, ChannelStatus } from './channel';
export declare class WhatsAppChannel implements Channel {
    readonly name = "whatsapp";
    private phoneNumberId;
    private accessToken;
    private verifyToken;
    private webhookPath;
    private webhookPort;
    private server;
    private messageHandler;
    private connectedAt;
    private messagesSent;
    private messagesReceived;
    connect(config: ChannelConfig): Promise<void>;
    disconnect(): Promise<void>;
    private handleRequest;
    private handleWebhookPayload;
    private extractText;
    private extractAttachments;
    sendMessage(to: string, content: MessageContent): Promise<void>;
    onMessage(handler: (msg: IncomingMessage) => void): void;
    isConnected(): boolean;
    getStatus(): ChannelStatus;
}
//# sourceMappingURL=whatsapp.d.ts.map