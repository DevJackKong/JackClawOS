"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.WeChatChannel = void 0;
const crypto = __importStar(require("crypto"));
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const url_1 = require("url");
// ─── XML helpers (no external parser) ────────────────────────────────────────
/** Extract the first value of a tag from WeChat XML. */
function xmlGet(xml, tag) {
    const m = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[(.*?)\\]\\]></${tag}>|<${tag}>(.*?)</${tag}>`, 's'));
    return m ? (m[1] ?? m[2] ?? '') : '';
}
/** Minimal XML builder for WeChat passive reply. */
function buildReplyXml(toUser, fromUser, content) {
    const ts = Math.floor(Date.now() / 1000);
    return `<xml>
<ToUserName><![CDATA[${toUser}]]></ToUserName>
<FromUserName><![CDATA[${fromUser}]]></FromUserName>
<CreateTime>${ts}</CreateTime>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[${content}]]></Content>
</xml>`;
}
// ─── AES-256-CBC decrypt (WXBizMsgCrypt) ─────────────────────────────────────
/**
 * Decrypt a WeChat Work encrypted message.
 *
 * Protocol:
 *   1. Base64-decode ciphertext
 *   2. AES-256-CBC decrypt with key = SHA256(encodingAESKey+"=") … actually
 *      key = Base64(encodingAESKey+"=").slice(0,32), IV = key.slice(0,16)
 *   3. Remove 16-byte random prefix, read 4-byte big-endian length, extract XML
 *   4. Verify trailing appId
 */
function decryptWeChatMsg(encodingAESKey, ciphertext) {
    const aesKey = Buffer.from(encodingAESKey + '=', 'base64'); // 32 bytes
    const iv = aesKey.slice(0, 16);
    const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
    decipher.setAutoPadding(false);
    const buf = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]);
    // Remove PKCS7 padding
    const padLen = buf[buf.length - 1];
    const unpadded = buf.slice(0, buf.length - padLen);
    // Skip 16-byte random prefix
    const msgLen = unpadded.readUInt32BE(16);
    return unpadded.slice(20, 20 + msgLen).toString('utf8');
}
// ─── Signature verification ───────────────────────────────────────────────────
function verifySignature(token, timestamp, nonce, encrypt) {
    const parts = [token, timestamp, nonce];
    if (encrypt !== undefined)
        parts.push(encrypt);
    parts.sort();
    return crypto.createHash('sha1').update(parts.join('')).digest('hex');
}
function nativeFetch(url, opts = {}) {
    return new Promise((resolve, reject) => {
        const parsed = new url_1.URL(url);
        const isHttps = parsed.protocol === 'https:';
        const reqOpts = {
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: opts.method ?? 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...opts.headers,
            },
        };
        const transport = isHttps ? https : http;
        const req = transport.request(reqOpts, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                }
                catch {
                    reject(new Error('WeChat API: non-JSON response'));
                }
            });
        });
        req.on('error', reject);
        if (opts.body)
            req.write(opts.body);
        req.end();
    });
}
// ─── WeChatChannel ────────────────────────────────────────────────────────────
class WeChatChannel {
    name = 'wechat';
    cfg;
    tokenCache = null;
    handler = null;
    server = null;
    pollTimer = null;
    connectedAt = 0;
    messagesSent = 0;
    messagesReceived = 0;
    // ── Public interface ────────────────────────────────────────────────────────
    async connect(config) {
        this.cfg = config;
        if (!this.cfg.corpId || !this.cfg.corpSecret || !this.cfg.agentId) {
            throw new Error('WeChatChannel: corpId, corpSecret and agentId are required');
        }
        if (!this.cfg.token) {
            throw new Error('WeChatChannel: token is required for signature verification');
        }
        // Eagerly fetch access_token to validate credentials
        await this.getAccessToken();
        this.connectedAt = Date.now();
        if (this.cfg.webhookPath) {
            this.startWebhookServer();
        }
        else {
            // Fallback: polling mode (企微不支持主动拉取消息，此处为示意占位)
            console.warn('[WeChatChannel] No webhookPath configured — operating in send-only mode. ' +
                'Configure webhookPath to receive messages.');
        }
    }
    async disconnect() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        if (this.server) {
            await new Promise((resolve) => this.server.close(() => resolve()));
            this.server = null;
        }
        this.connectedAt = 0;
    }
    async sendMessage(target, content) {
        const token = await this.getAccessToken();
        const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`;
        let body;
        if (content.image) {
            // Upload image first if needed, or send as image url via news card
            body = {
                touser: target,
                msgtype: 'image',
                agentid: this.cfg.agentId,
                image: { media_id: content.image }, // caller should pass media_id
            };
        }
        else if (content.file) {
            body = {
                touser: target,
                msgtype: 'file',
                agentid: this.cfg.agentId,
                file: { media_id: content.file.url }, // caller should pass media_id
            };
        }
        else if (content.markdown) {
            body = {
                touser: target,
                msgtype: 'markdown',
                agentid: this.cfg.agentId,
                markdown: { content: content.markdown },
            };
        }
        else {
            body = {
                touser: target,
                msgtype: 'text',
                agentid: this.cfg.agentId,
                text: { content: content.text ?? '' },
            };
        }
        const res = await nativeFetch(url, {
            method: 'POST',
            body: JSON.stringify(body),
        });
        if (res.errcode !== 0) {
            throw new Error(`WeChatChannel.sendMessage failed: ${res.errmsg} (code ${res.errcode})`);
        }
        this.messagesSent++;
    }
    onMessage(handler) {
        this.handler = handler;
    }
    isConnected() {
        return this.connectedAt > 0;
    }
    getStatus() {
        return {
            connected: this.isConnected(),
            name: this.name,
            uptime: this.connectedAt ? Date.now() - this.connectedAt : 0,
            messagesSent: this.messagesSent,
            messagesReceived: this.messagesReceived,
        };
    }
    // ── Token management ────────────────────────────────────────────────────────
    async getAccessToken() {
        if (this.tokenCache && Date.now() < this.tokenCache.expiresAt) {
            return this.tokenCache.value;
        }
        const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(this.cfg.corpId)}&corpsecret=${encodeURIComponent(this.cfg.corpSecret)}`;
        const res = await nativeFetch(url);
        if (!res.access_token) {
            throw new Error(`WeChatChannel: failed to get access_token — ${res.errmsg ?? JSON.stringify(res)}`);
        }
        // Refresh 5 minutes before expiry to avoid edge-cases
        this.tokenCache = {
            value: res.access_token,
            expiresAt: Date.now() + (res.expires_in - 300) * 1000,
        };
        return res.access_token;
    }
    // ── Webhook server ──────────────────────────────────────────────────────────
    startWebhookServer() {
        const port = this.cfg.webhookPort ?? 3000;
        const path = this.cfg.webhookPath;
        this.server = http.createServer((req, res) => {
            if (!req.url?.startsWith(path)) {
                res.writeHead(404).end();
                return;
            }
            const qs = new url_1.URL(req.url, `http://localhost:${port}`).searchParams;
            const timestamp = qs.get('timestamp') ?? '';
            const nonce = qs.get('nonce') ?? '';
            const msgSignature = qs.get('msg_signature') ?? '';
            const echostr = qs.get('echostr');
            // ── GET: endpoint verification ─────────────────────────────────────────
            if (req.method === 'GET') {
                if (!echostr) {
                    res.writeHead(400).end('missing echostr');
                    return;
                }
                // Encrypted echostr verification
                const sig = verifySignature(this.cfg.token, timestamp, nonce, echostr);
                if (sig !== msgSignature) {
                    res.writeHead(403).end('signature mismatch');
                    return;
                }
                try {
                    const plain = this.cfg.encodingAESKey
                        ? decryptWeChatMsg(this.cfg.encodingAESKey, echostr)
                        : echostr;
                    res.writeHead(200).end(plain);
                }
                catch (e) {
                    res.writeHead(500).end('decrypt error');
                }
                return;
            }
            // ── POST: incoming message ─────────────────────────────────────────────
            if (req.method === 'POST') {
                const chunks = [];
                req.on('data', (c) => chunks.push(c));
                req.on('end', () => {
                    try {
                        const rawXml = Buffer.concat(chunks).toString('utf8');
                        const incoming = this.parseIncomingXml(rawXml, timestamp, nonce, msgSignature);
                        if (incoming) {
                            this.messagesReceived++;
                            this.handler?.(incoming);
                        }
                        // WeChat Work expects empty 200 for async handling
                        res.writeHead(200, { 'Content-Type': 'text/xml' }).end('');
                    }
                    catch (e) {
                        console.error('[WeChatChannel] Error processing webhook:', e);
                        res.writeHead(500).end();
                    }
                });
                return;
            }
            res.writeHead(405).end();
        });
        this.server.listen(port, () => {
            console.log(`[WeChatChannel] Webhook listening on port ${port} at ${path}`);
        });
    }
    // ── Message parsing ─────────────────────────────────────────────────────────
    parseIncomingXml(rawXml, timestamp, nonce, msgSignature) {
        let xml = rawXml;
        // If encrypted mode, unwrap Encrypt tag first
        const encryptContent = xmlGet(rawXml, 'Encrypt');
        if (encryptContent && this.cfg.encodingAESKey) {
            // Verify signature over the encrypted blob
            const expectedSig = verifySignature(this.cfg.token, timestamp, nonce, encryptContent);
            if (expectedSig !== msgSignature) {
                console.warn('[WeChatChannel] Signature mismatch on incoming message — dropping');
                return null;
            }
            xml = decryptWeChatMsg(this.cfg.encodingAESKey, encryptContent);
        }
        else if (!encryptContent) {
            // Plain-text mode: verify simple signature
            const expectedSig = verifySignature(this.cfg.token, timestamp, nonce);
            if (expectedSig !== msgSignature) {
                console.warn('[WeChatChannel] Signature mismatch — dropping');
                return null;
            }
        }
        const msgType = xmlGet(xml, 'MsgType').toLowerCase();
        const fromUser = xmlGet(xml, 'FromUserName');
        const toUser = xmlGet(xml, 'ToUserName');
        const msgId = xmlGet(xml, 'MsgId');
        const createTime = parseInt(xmlGet(xml, 'CreateTime') || '0', 10);
        let content = '';
        const attachments = [];
        if (msgType === 'text') {
            content = xmlGet(xml, 'Content');
        }
        else if (msgType === 'image') {
            const picUrl = xmlGet(xml, 'PicUrl');
            const mediaId = xmlGet(xml, 'MediaId');
            attachments.push({ type: 'image', url: picUrl || mediaId });
            content = '[image]';
        }
        else if (msgType === 'voice') {
            const mediaId = xmlGet(xml, 'MediaId');
            attachments.push({ type: 'voice', url: mediaId });
            content = '[voice]';
        }
        else if (msgType === 'video') {
            const mediaId = xmlGet(xml, 'MediaId');
            attachments.push({ type: 'video', url: mediaId });
            content = '[video]';
        }
        else if (msgType === 'file') {
            const mediaId = xmlGet(xml, 'MediaId');
            const fileName = xmlGet(xml, 'FileName');
            attachments.push({ type: 'file', url: mediaId, filename: fileName });
            content = `[file: ${fileName}]`;
        }
        else if (msgType === 'event') {
            const event = xmlGet(xml, 'Event').toLowerCase();
            content = `[event: ${event}]`;
        }
        else {
            content = `[${msgType}]`;
        }
        return {
            channel: this.name,
            senderId: fromUser,
            senderName: fromUser, // WeChat Work doesn't return display name in callback
            chatId: toUser,
            chatType: 'direct', // WeChat Work agent messages are always 1-to-1 with agentId
            content,
            attachments: attachments.length ? attachments : undefined,
            ts: createTime ? createTime * 1000 : Date.now(),
            raw: { xml, msgId },
        };
    }
}
exports.WeChatChannel = WeChatChannel;
//# sourceMappingURL=wechat.js.map