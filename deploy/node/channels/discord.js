"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiscordChannel = void 0;
const tls_1 = __importDefault(require("tls"));
const crypto_1 = __importDefault(require("crypto"));
const events_1 = require("events");
const DISCORD_REST = 'https://discord.com/api/v10';
const GATEWAY_HOST = 'gateway.discord.gg';
const GATEWAY_PATH = '/?v=10&encoding=json';
// Discord Gateway opcodes
const OP_DISPATCH = 0;
const OP_HEARTBEAT = 1;
const OP_IDENTIFY = 2;
const OP_HELLO = 10;
const OP_HEARTBEAT_ACK = 11;
// Gateway intents: GUILDS | GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT
const DEFAULT_INTENTS = 1 | 512 | 4096 | 32768;
// ── Minimal WebSocket client over native TLS ──────────────────────────────────
/**
 * Lightweight WebSocket client built on Node's `tls` module.
 * Supports text frames + control frames (ping/pong/close).
 * Client→Server frames are masked as required by RFC 6455.
 */
class NativeWebSocket extends events_1.EventEmitter {
    socket = null;
    recvBuf = Buffer.alloc(0);
    upgraded = false;
    _open = false;
    connect(host, path) {
        const wsKey = crypto_1.default.randomBytes(16).toString('base64');
        const sock = tls_1.default.connect({ host, port: 443, servername: host }, () => {
            const req = [
                `GET ${path} HTTP/1.1`,
                `Host: ${host}`,
                'Upgrade: websocket',
                'Connection: Upgrade',
                `Sec-WebSocket-Key: ${wsKey}`,
                'Sec-WebSocket-Version: 13',
                '',
                '',
            ].join('\r\n');
            sock.write(req);
        });
        this.socket = sock;
        sock.on('data', (chunk) => {
            if (!this.upgraded) {
                // Wait for HTTP 101 response
                const str = chunk.toString('binary');
                if (!str.includes('101')) {
                    this.emit('error', new Error(`WebSocket upgrade failed: ${str.slice(0, 200)}`));
                    sock.destroy();
                    return;
                }
                this.upgraded = true;
                this._open = true;
                this.emit('open');
                // Data after the HTTP headers belongs to the WebSocket stream
                const boundary = chunk.indexOf('\r\n\r\n');
                if (boundary !== -1 && boundary + 4 < chunk.length) {
                    this.recvBuf = Buffer.concat([this.recvBuf, chunk.slice(boundary + 4)]);
                    this.parseFrames();
                }
                return;
            }
            this.recvBuf = Buffer.concat([this.recvBuf, chunk]);
            this.parseFrames();
        });
        sock.on('close', () => {
            this._open = false;
            this.emit('close');
        });
        sock.on('error', (err) => this.emit('error', err));
    }
    // ── Frame parser ──────────────────────────────────────────────────────────
    parseFrames() {
        while (this.recvBuf.length >= 2) {
            const byte0 = this.recvBuf[0];
            const byte1 = this.recvBuf[1];
            const opcode = byte0 & 0x0f;
            const masked = (byte1 & 0x80) !== 0;
            let payloadLen = byte1 & 0x7f;
            let offset = 2;
            if (payloadLen === 126) {
                if (this.recvBuf.length < 4)
                    return;
                payloadLen = this.recvBuf.readUInt16BE(2);
                offset = 4;
            }
            else if (payloadLen === 127) {
                if (this.recvBuf.length < 10)
                    return;
                // Node Buffer readUInt32BE reads 32-bit values; combine high/low for 64-bit length
                // (messages this large are extremely unlikely on the Discord gateway)
                const hi = this.recvBuf.readUInt32BE(2);
                const lo = this.recvBuf.readUInt32BE(6);
                payloadLen = hi * 0x1_0000_0000 + lo;
                offset = 10;
            }
            if (masked)
                offset += 4;
            if (this.recvBuf.length < offset + payloadLen)
                return;
            let payload;
            if (masked) {
                const mask = this.recvBuf.slice(offset - 4, offset);
                payload = Buffer.alloc(payloadLen);
                for (let i = 0; i < payloadLen; i++) {
                    payload[i] = this.recvBuf[offset + i] ^ mask[i % 4];
                }
            }
            else {
                payload = this.recvBuf.slice(offset, offset + payloadLen);
            }
            this.recvBuf = this.recvBuf.slice(offset + payloadLen);
            switch (opcode) {
                case 0x1: // text
                case 0x2: // binary
                    this.emit('message', payload.toString('utf8'));
                    break;
                case 0x8: // close
                    sock_destroy: {
                        this.socket?.destroy();
                    }
                    break;
                case 0x9: // ping → send pong
                    this.sendFrame(0xa, payload);
                    break;
                case 0xa: // pong
                    break;
            }
        }
    }
    // ── Frame writer ──────────────────────────────────────────────────────────
    send(data) {
        this.sendFrame(0x1, Buffer.from(data, 'utf8'));
    }
    sendFrame(opcode, payload) {
        if (!this.socket || !this._open)
            return;
        const mask = crypto_1.default.randomBytes(4);
        const masked = Buffer.alloc(payload.length);
        for (let i = 0; i < payload.length; i++) {
            masked[i] = payload[i] ^ mask[i % 4];
        }
        let header;
        if (payload.length < 126) {
            header = Buffer.alloc(6);
            header[0] = 0x80 | opcode;
            header[1] = 0x80 | payload.length;
            mask.copy(header, 2);
        }
        else if (payload.length < 65536) {
            header = Buffer.alloc(8);
            header[0] = 0x80 | opcode;
            header[1] = 0x80 | 126;
            header.writeUInt16BE(payload.length, 2);
            mask.copy(header, 4);
        }
        else {
            header = Buffer.alloc(14);
            header[0] = 0x80 | opcode;
            header[1] = 0x80 | 127;
            header.writeUInt32BE(0, 2);
            header.writeUInt32BE(payload.length >>> 0, 6);
            mask.copy(header, 10);
        }
        this.socket.write(Buffer.concat([header, masked]));
    }
    isOpen() { return this._open; }
    destroy() {
        this._open = false;
        this.socket?.destroy();
        this.socket = null;
    }
}
// ── DiscordChannel ────────────────────────────────────────────────────────────
class DiscordChannel {
    name = 'discord';
    botToken = '';
    intents = DEFAULT_INTENTS;
    ws = null;
    heartbeatTimer = null;
    lastSequence = null;
    sessionId = null;
    messageHandler = null;
    connectedAt = 0;
    messagesSent = 0;
    messagesReceived = 0;
    _connected = false;
    // ------------------------------------------------------------------ connect
    async connect(config) {
        this.botToken = config['botToken'] ?? config.token ?? '';
        this.intents = config['intents'] ?? DEFAULT_INTENTS;
        if (!this.botToken)
            throw new Error('DiscordChannel: botToken is required');
        await this.openGateway();
        this.connectedAt = Date.now();
    }
    openGateway() {
        return new Promise((resolve, reject) => {
            const ws = new NativeWebSocket();
            this.ws = ws;
            const onError = (err) => {
                reject(err);
            };
            ws.once('error', onError);
            ws.on('open', () => {
                console.log('[DiscordChannel] Gateway WebSocket connected');
            });
            ws.on('message', (raw) => {
                try {
                    const payload = JSON.parse(raw);
                    this.handleGatewayPayload(payload, () => {
                        ws.removeListener('error', onError);
                        resolve();
                    });
                }
                catch (e) {
                    console.error('[DiscordChannel] Failed to parse gateway payload:', e);
                }
            });
            ws.on('close', () => {
                this._connected = false;
                this.clearHeartbeat();
                console.log('[DiscordChannel] Gateway disconnected');
            });
            ws.connect(GATEWAY_HOST, GATEWAY_PATH);
        });
    }
    // ------------------------------------------------------------------ gateway
    handleGatewayPayload(payload, onReady) {
        if (payload.s !== null && payload.s !== undefined) {
            this.lastSequence = payload.s;
        }
        switch (payload.op) {
            case OP_HELLO: {
                const d = payload.d;
                this.startHeartbeat(d.heartbeat_interval);
                this.sendIdentify();
                break;
            }
            case OP_HEARTBEAT_ACK:
                // heartbeat acknowledged — nothing to do
                break;
            case OP_DISPATCH:
                this.handleDispatch(payload, onReady);
                break;
        }
    }
    handleDispatch(payload, onReady) {
        switch (payload.t) {
            case 'READY': {
                const d = payload.d;
                this.sessionId = d.session_id;
                this._connected = true;
                console.log('[DiscordChannel] READY — session:', this.sessionId);
                onReady();
                break;
            }
            case 'MESSAGE_CREATE': {
                if (!this.messageHandler)
                    break;
                const msg = payload.d;
                // Skip messages from bots (including self)
                if (msg.author?.bot)
                    break;
                const attachments = msg.attachments?.map(a => ({
                    type: a.content_type?.startsWith('image/') ? 'image' : 'file',
                    url: a.url,
                    filename: a.filename,
                }));
                const incoming = {
                    channel: this.name,
                    senderId: msg.author.id,
                    senderName: msg.author.username,
                    chatId: msg.channel_id,
                    chatType: msg.guild_id ? 'group' : 'direct',
                    content: msg.content,
                    attachments: attachments?.length ? attachments : undefined,
                    replyTo: msg.referenced_message?.id,
                    ts: new Date(msg.timestamp).getTime(),
                    raw: msg,
                };
                this.messagesReceived++;
                this.messageHandler(incoming);
                break;
            }
        }
    }
    sendIdentify() {
        this.ws?.send(JSON.stringify({
            op: OP_IDENTIFY,
            d: {
                token: this.botToken,
                intents: this.intents,
                properties: { os: 'linux', browser: 'jackclaw', device: 'jackclaw' },
            },
        }));
    }
    startHeartbeat(intervalMs) {
        this.clearHeartbeat();
        // Send first heartbeat after random jitter to avoid thundering-herd on reconnect
        const jitter = Math.floor(Math.random() * intervalMs);
        const hb = () => {
            this.ws?.send(JSON.stringify({ op: OP_HEARTBEAT, d: this.lastSequence }));
        };
        setTimeout(() => {
            hb();
            this.heartbeatTimer = setInterval(hb, intervalMs);
        }, jitter);
    }
    clearHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
    // ------------------------------------------------------------------ Channel interface
    async disconnect() {
        this.clearHeartbeat();
        this.ws?.destroy();
        this.ws = null;
        this._connected = false;
    }
    async sendMessage(target, content) {
        const url = `${DISCORD_REST}/channels/${target}/messages`;
        const body = {
            content: content.text ?? content.markdown ?? '',
        };
        if (content.image) {
            body['embeds'] = [{ image: { url: content.image } }];
        }
        if (content.replyTo) {
            body['message_reference'] = { message_id: content.replyTo };
        }
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bot ${this.botToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Discord API error ${res.status}: ${err}`);
        }
        this.messagesSent++;
    }
    onMessage(handler) {
        this.messageHandler = handler;
    }
    isConnected() {
        return this._connected;
    }
    getStatus() {
        return {
            connected: this._connected,
            name: this.name,
            uptime: this._connected ? Date.now() - this.connectedAt : 0,
            messagesSent: this.messagesSent,
            messagesReceived: this.messagesReceived,
        };
    }
}
exports.DiscordChannel = DiscordChannel;
//# sourceMappingURL=discord.js.map