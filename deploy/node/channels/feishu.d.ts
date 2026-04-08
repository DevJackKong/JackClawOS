/**
 * feishu.ts — Feishu/Lark Open Platform channel adapter for ClawChat bridge
 *
 * Uses Node.js native fetch (Node 20+) and built-in crypto. No npm dependencies.
 * Primary mode: webhook — expose handleWebhookRequest() to your HTTP server.
 * Fallback mode: polling — pass pollChatIds in config to enable periodic pull.
 *
 * AES-256-CBC decryption: key = SHA-256(encryptKey), IV = first 16 bytes of key.
 */
import { Channel, ChannelConfig, IncomingMessage, MessageContent, ChannelStatus } from './channel';
export declare class FeishuChannel implements Channel {
    readonly name = "feishu";
    private appId;
    private appSecret;
    private verificationToken;
    private encryptKey;
    /** Current tenant_access_token */
    private accessToken;
    /** Epoch ms when the token should be considered expired */
    private tokenExpiresAt;
    private tokenRefreshTimer;
    private messageHandler;
    private connected;
    private connectedAt;
    private messagesSent;
    private messagesReceived;
    /** Polling mode: list of chat_ids to pull periodically */
    private pollChatIds;
    private pollInterval;
    private pollTimer;
    /** Per-chat last-seen create_time (ms) to avoid re-dispatching */
    private pollLastTs;
    private fetchToken;
    private ensureToken;
    private get authHeaders();
    private post;
    private get;
    /**
     * Decrypt Feishu AES-256-CBC payload.
     * key  = SHA-256(encryptKey)
     * iv   = first 16 bytes of key
     * data = base64-decoded ciphertext
     */
    private decrypt;
    private parseContent;
    private dispatchEvent;
    private pollOnce;
    connect(config: ChannelConfig): Promise<void>;
    disconnect(): Promise<void>;
    sendMessage(target: string, content: MessageContent): Promise<void>;
    onMessage(handler: (msg: IncomingMessage) => void): void;
    isConnected(): boolean;
    getStatus(): ChannelStatus;
    /**
     * Process an inbound Feishu webhook request.
     * Wire into your HTTP server's POST handler, e.g.:
     *
     *   app.post('/webhook/feishu', express.text({ type: '*\/*' }), async (req, res) => {
     *     const { status, body } = await feishu.handleWebhookRequest(req.body)
     *     res.status(status).send(body)
     *   })
     *
     * @param rawBody  Raw request body as a string
     * @returns        HTTP status code and body to return to Feishu
     */
    handleWebhookRequest(rawBody: string): Promise<{
        status: number;
        body: string;
    }>;
}
//# sourceMappingURL=feishu.d.ts.map