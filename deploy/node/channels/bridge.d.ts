/**
 * bridge.ts — ChannelBridge: core router between IM channels and ClawChat
 *
 * Responsibilities:
 *  - Maintain a registry of connected Channel adapters
 *  - Translate IncomingMessage → ClawChat API calls (bridgeToClawChat)
 *  - Translate ClawChat messages → IM sends (bridgeFromClawChat)
 *  - Persist handle mappings and channel configs to ~/.jackclaw/node/channels.json
 */
import type { Channel, ChannelConfig, IncomingMessage } from './channel';
export declare class ChannelBridge {
    private channels;
    private hubUrl;
    private nodeId;
    private token?;
    constructor(opts: {
        hubUrl: string;
        nodeId: string;
        token?: string;
    });
    registerChannel(channel: Channel): void;
    removeChannel(name: string): void;
    getChannel(name: string): Channel | undefined;
    listChannels(): {
        name: string;
        connected: boolean;
    }[];
    /**
     * Map an IM user ID (e.g. telegram:123456) → ClawChat @handle
     */
    setHandleMapping(imUserId: string, agentHandle: string): void;
    getHandleMapping(imUserId: string): string | undefined;
    /**
     * Forward an IncomingMessage from any IM channel to ClawChat Hub.
     *
     * Routing logic:
     *   - If sender has a handle mapping → POST /api/social/send (agent-to-agent)
     *   - Otherwise                      → POST /api/chat/send   (human/external)
     */
    bridgeToClawChat(msg: IncomingMessage): Promise<void>;
    /**
     * Send a ClawChat message out through the named IM channel.
     *
     * @param clawMsg      ClawChat message object (must have `.content` string)
     * @param targetChannel  Channel name, e.g. 'telegram'
     * @param targetId       Recipient ID on that platform (user/group)
     */
    bridgeFromClawChat(clawMsg: {
        content: string;
        markdown?: string;
        image?: string;
        replyTo?: string;
    }, targetChannel: string, targetId: string): Promise<void>;
    /**
     * Connect all channels whose configs are saved in channels.json.
     * Called at Node startup; failures are non-fatal.
     */
    autoConnect(): Promise<void>;
    /**
     * Save a channel config to channels.json (persists for auto-connect on restart).
     */
    saveChannelConfig(name: string, config: ChannelConfig): void;
    /**
     * Disconnect all channels cleanly (called on SIGTERM/SIGINT).
     */
    disconnectAll(): Promise<void>;
}
//# sourceMappingURL=bridge.d.ts.map