"use strict";
/**
 * bridge.ts — ChannelBridge: core router between IM channels and ClawChat
 *
 * Responsibilities:
 *  - Maintain a registry of connected Channel adapters
 *  - Translate IncomingMessage → ClawChat API calls (bridgeToClawChat)
 *  - Translate ClawChat messages → IM sends (bridgeFromClawChat)
 *  - Persist handle mappings and channel configs to ~/.jackclaw/node/channels.json
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChannelBridge = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const axios_1 = __importDefault(require("axios"));
// ── Persistence ──────────────────────────────────────────────────────────────
const CHANNELS_DIR = path_1.default.join(os_1.default.homedir(), '.jackclaw', 'node');
const CHANNELS_FILE = path_1.default.join(CHANNELS_DIR, 'channels.json');
function loadChannelsFile() {
    if (!fs_1.default.existsSync(CHANNELS_FILE)) {
        return { handleMappings: {}, channelConfigs: {} };
    }
    try {
        return JSON.parse(fs_1.default.readFileSync(CHANNELS_FILE, 'utf8'));
    }
    catch {
        return { handleMappings: {}, channelConfigs: {} };
    }
}
function saveChannelsFile(data) {
    fs_1.default.mkdirSync(CHANNELS_DIR, { recursive: true });
    fs_1.default.writeFileSync(CHANNELS_FILE, JSON.stringify(data, null, 2));
}
// ── ChannelBridge ─────────────────────────────────────────────────────────────
class ChannelBridge {
    channels = new Map();
    hubUrl;
    nodeId;
    token;
    constructor(opts) {
        this.hubUrl = opts.hubUrl;
        this.nodeId = opts.nodeId;
        this.token = opts.token;
    }
    // ── Channel registry ────────────────────────────────────────────────────────
    registerChannel(channel) {
        this.channels.set(channel.name, channel);
        // Wire incoming messages immediately
        channel.onMessage((msg) => this.bridgeToClawChat(msg).catch((err) => console.error(`[bridge:${channel.name}] bridgeToClawChat error:`, err.message)));
        console.log(`[bridge] Registered channel: ${channel.name}`);
    }
    removeChannel(name) {
        const ch = this.channels.get(name);
        if (ch) {
            ch.disconnect().catch(() => { });
            this.channels.delete(name);
            console.log(`[bridge] Removed channel: ${name}`);
        }
    }
    getChannel(name) {
        return this.channels.get(name);
    }
    listChannels() {
        return Array.from(this.channels.values()).map((ch) => ({
            name: ch.name,
            connected: ch.isConnected(),
        }));
    }
    // ── Handle mappings ─────────────────────────────────────────────────────────
    /**
     * Map an IM user ID (e.g. telegram:123456) → ClawChat @handle
     */
    setHandleMapping(imUserId, agentHandle) {
        const data = loadChannelsFile();
        data.handleMappings[imUserId] = agentHandle;
        saveChannelsFile(data);
    }
    getHandleMapping(imUserId) {
        return loadChannelsFile().handleMappings[imUserId];
    }
    // ── Bridge: IM → ClawChat ───────────────────────────────────────────────────
    /**
     * Forward an IncomingMessage from any IM channel to ClawChat Hub.
     *
     * Routing logic:
     *   - If sender has a handle mapping → POST /api/social/send (agent-to-agent)
     *   - Otherwise                      → POST /api/chat/send   (human/external)
     */
    async bridgeToClawChat(msg) {
        const mappedHandle = this.getHandleMapping(msg.senderId);
        const payload = {
            from: mappedHandle ?? msg.senderId,
            content: msg.content,
            channel: msg.channel,
            senderId: msg.senderId,
            senderName: msg.senderName,
            chatId: msg.chatId,
            chatType: msg.chatType,
            attachments: msg.attachments,
            replyTo: msg.replyTo,
            ts: msg.ts,
            raw: msg.raw,
        };
        const endpoint = mappedHandle
            ? `${this.hubUrl}/api/social/send`
            : `${this.hubUrl}/api/chat/send`;
        try {
            await axios_1.default.post(endpoint, payload, { timeout: 10_000, headers: this.token ? { Authorization: `Bearer ${this.token}` } : {} });
            console.log(`[bridge] IM→ClawChat [${msg.channel}] from=${msg.senderId} → ${endpoint}`);
        }
        catch (err) {
            console.error(`[bridge] IM→ClawChat failed [${msg.channel}]:`, err?.response?.data ?? err.message);
        }
    }
    // ── Bridge: ClawChat → IM ───────────────────────────────────────────────────
    /**
     * Send a ClawChat message out through the named IM channel.
     *
     * @param clawMsg      ClawChat message object (must have `.content` string)
     * @param targetChannel  Channel name, e.g. 'telegram'
     * @param targetId       Recipient ID on that platform (user/group)
     */
    async bridgeFromClawChat(clawMsg, targetChannel, targetId) {
        const ch = this.channels.get(targetChannel);
        if (!ch) {
            console.warn(`[bridge] Channel not found: ${targetChannel}`);
            return;
        }
        if (!ch.isConnected()) {
            console.warn(`[bridge] Channel not connected: ${targetChannel}`);
            return;
        }
        const content = {
            text: clawMsg.content,
            markdown: clawMsg.markdown,
            image: clawMsg.image,
            replyTo: clawMsg.replyTo,
        };
        try {
            await ch.sendMessage(targetId, content);
            console.log(`[bridge] ClawChat→IM [${targetChannel}] to=${targetId}`);
        }
        catch (err) {
            console.error(`[bridge] ClawChat→IM failed [${targetChannel}]:`, err.message);
        }
    }
    // ── Auto-connect from saved config ─────────────────────────────────────────
    /**
     * Connect all channels whose configs are saved in channels.json.
     * Called at Node startup; failures are non-fatal.
     */
    async autoConnect() {
        const { channelConfigs } = loadChannelsFile();
        const names = Object.keys(channelConfigs);
        if (names.length === 0)
            return;
        console.log(`[bridge] Auto-connecting ${names.length} saved channel(s): ${names.join(', ')}`);
        for (const name of names) {
            const ch = this.channels.get(name);
            if (!ch) {
                console.warn(`[bridge] Auto-connect: no adapter registered for "${name}", skipping`);
                continue;
            }
            try {
                await ch.connect(channelConfigs[name]);
                console.log(`[bridge] Auto-connected: ${name}`);
            }
            catch (err) {
                console.error(`[bridge] Auto-connect failed for ${name}:`, err.message);
            }
        }
    }
    /**
     * Save a channel config to channels.json (persists for auto-connect on restart).
     */
    saveChannelConfig(name, config) {
        const data = loadChannelsFile();
        data.channelConfigs[name] = config;
        saveChannelsFile(data);
    }
    /**
     * Disconnect all channels cleanly (called on SIGTERM/SIGINT).
     */
    async disconnectAll() {
        for (const ch of this.channels.values()) {
            try {
                await ch.disconnect();
            }
            catch {
                // best-effort
            }
        }
    }
}
exports.ChannelBridge = ChannelBridge;
//# sourceMappingURL=bridge.js.map