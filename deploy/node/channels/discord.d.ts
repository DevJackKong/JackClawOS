/**
 * discord.ts — Discord Bot API channel adapter for ClawChat bridge
 *
 * Uses Node.js built-in tls module for WebSocket Gateway (no npm deps).
 * REST calls use native fetch (Node 18+).
 *
 * Gateway: wss://gateway.discord.gg/?v=10&encoding=json
 *   op 10 Hello     → start heartbeat + send Identify
 *   op 11 HB ACK    → acknowledged
 *   op  0 Dispatch  → READY (session ready) / MESSAGE_CREATE (new message)
 *
 * Important: enable MESSAGE_CONTENT privileged intent in Discord Developer Portal
 * if you need message body in guild channels.
 */
import { Channel, ChannelConfig, IncomingMessage, MessageContent, ChannelStatus } from './channel';
export declare class DiscordChannel implements Channel {
    readonly name = "discord";
    private botToken;
    private intents;
    private ws;
    private heartbeatTimer;
    private lastSequence;
    private sessionId;
    private messageHandler;
    private connectedAt;
    private messagesSent;
    private messagesReceived;
    private _connected;
    connect(config: ChannelConfig): Promise<void>;
    private openGateway;
    private handleGatewayPayload;
    private handleDispatch;
    private sendIdentify;
    private startHeartbeat;
    private clearHeartbeat;
    disconnect(): Promise<void>;
    sendMessage(target: string, content: MessageContent): Promise<void>;
    onMessage(handler: (msg: IncomingMessage) => void): void;
    isConnected(): boolean;
    getStatus(): ChannelStatus;
}
//# sourceMappingURL=discord.d.ts.map