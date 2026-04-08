/**
 * telegram.ts — Telegram Bot API channel adapter for ClawChat bridge
 *
 * Uses Node.js native fetch (Node 18+). No npm dependencies.
 * Long polling via getUpdates with timeout=30 for near-realtime delivery.
 */
import { Channel, ChannelConfig, IncomingMessage, MessageContent, ChannelStatus } from './channel';
interface TelegramUser {
    id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
    username?: string;
}
interface TelegramChat {
    id: number;
    type: 'private' | 'group' | 'supergroup' | 'channel';
    title?: string;
    username?: string;
    first_name?: string;
}
interface TelegramPhotoSize {
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
    file_size?: number;
}
interface TelegramDocument {
    file_id: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
}
interface TelegramVoice {
    file_id: string;
    duration: number;
    mime_type?: string;
    file_size?: number;
}
interface TelegramMessage {
    message_id: number;
    from?: TelegramUser;
    chat: TelegramChat;
    date: number;
    text?: string;
    caption?: string;
    photo?: TelegramPhotoSize[];
    document?: TelegramDocument;
    voice?: TelegramVoice;
    reply_to_message?: TelegramMessage;
}
interface TelegramUpdate {
    update_id: number;
    message?: TelegramMessage;
    edited_message?: TelegramMessage;
    channel_post?: TelegramMessage;
}
export declare class TelegramChannel implements Channel {
    readonly name = "telegram";
    private token;
    private polling;
    private offset;
    private messageHandler;
    private connectedAt;
    private messagesSent;
    private messagesReceived;
    private apiUrl;
    private apiGet;
    private apiPost;
    private poll;
    connect(config: ChannelConfig): Promise<void>;
    disconnect(): Promise<void>;
    sendMessage(target: string, content: MessageContent): Promise<void>;
    onMessage(handler: (msg: IncomingMessage) => void): void;
    isConnected(): boolean;
    getStatus(): ChannelStatus;
    handleUpdate(update: TelegramUpdate): void;
}
export {};
//# sourceMappingURL=telegram.d.ts.map