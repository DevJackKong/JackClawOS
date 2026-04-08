"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppChannel = void 0;
const http_1 = __importDefault(require("http"));
const GRAPH_API = 'https://graph.facebook.com/v19.0';
class WhatsAppChannel {
    name = 'whatsapp';
    phoneNumberId = '';
    accessToken = '';
    verifyToken = '';
    webhookPath = '/webhook/whatsapp';
    webhookPort = 3002;
    server = null;
    messageHandler = null;
    connectedAt = 0;
    messagesSent = 0;
    messagesReceived = 0;
    // ------------------------------------------------------------------ connect
    async connect(config) {
        this.phoneNumberId = config['phoneNumberId'] ?? '';
        this.accessToken = config['accessToken'] ?? config.token ?? '';
        this.verifyToken = config['verifyToken'] ?? '';
        this.webhookPath = config['webhookPath'] ?? '/webhook/whatsapp';
        this.webhookPort = config['webhookPort'] ?? 3002;
        if (!this.phoneNumberId || !this.accessToken) {
            throw new Error('WhatsAppChannel: phoneNumberId and accessToken are required');
        }
        this.server = http_1.default.createServer((req, res) => this.handleRequest(req, res));
        await new Promise((resolve, reject) => {
            this.server.listen(this.webhookPort, resolve);
            this.server.on('error', reject);
        });
        this.connectedAt = Date.now();
        console.log(`[WhatsAppChannel] Webhook listening on :${this.webhookPort}${this.webhookPath}`);
    }
    async disconnect() {
        if (this.server) {
            await new Promise((resolve) => this.server.close(() => resolve()));
            this.server = null;
        }
    }
    // ------------------------------------------------------------------ webhook
    handleRequest(req, res) {
        const url = new URL(req.url ?? '/', `http://localhost:${this.webhookPort}`);
        if (url.pathname !== this.webhookPath) {
            res.writeHead(404).end();
            return;
        }
        if (req.method === 'GET') {
            // Webhook verification handshake
            const mode = url.searchParams.get('hub.mode');
            const token = url.searchParams.get('hub.verify_token');
            const challenge = url.searchParams.get('hub.challenge');
            if (mode === 'subscribe' && token === this.verifyToken && challenge) {
                res.writeHead(200, { 'Content-Type': 'text/plain' }).end(challenge);
            }
            else {
                res.writeHead(403).end('Forbidden');
            }
            return;
        }
        if (req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
                try {
                    this.handleWebhookPayload(JSON.parse(body));
                    res.writeHead(200).end('OK');
                }
                catch {
                    res.writeHead(400).end('Bad Request');
                }
            });
            return;
        }
        res.writeHead(405).end('Method Not Allowed');
    }
    handleWebhookPayload(payload) {
        if (!this.messageHandler)
            return;
        try {
            const entry = payload['entry']?.[0];
            const change = entry?.['changes']?.[0];
            const value = change?.['value'];
            const messages = value?.['messages'];
            if (!messages?.length)
                return;
            const msg = messages[0];
            const contacts = value?.['contacts']?.[0];
            const profile = contacts?.['profile'];
            const incoming = {
                channel: this.name,
                senderId: String(msg['from'] ?? ''),
                senderName: String(profile?.['name'] ?? msg['from'] ?? ''),
                chatId: String(msg['from'] ?? ''),
                chatType: 'direct',
                content: this.extractText(msg),
                attachments: this.extractAttachments(msg),
                ts: parseInt(String(msg['timestamp'] ?? '0'), 10) * 1000,
                raw: payload,
            };
            this.messagesReceived++;
            this.messageHandler(incoming);
        }
        catch (e) {
            console.error('[WhatsAppChannel] handleWebhookPayload error:', e);
        }
    }
    extractText(msg) {
        const textObj = msg['text'];
        if (textObj?.['body'])
            return String(textObj['body']);
        if (msg['caption'])
            return String(msg['caption']);
        return '';
    }
    extractAttachments(msg) {
        const list = [];
        const push = (type, obj, filenameKey) => {
            if (!obj)
                return;
            list.push({
                type,
                url: String(obj['id'] ?? obj['link'] ?? ''),
                filename: filenameKey ? String(obj[filenameKey] ?? '') : undefined,
            });
        };
        push('image', msg['image']);
        push('document', msg['document'], 'filename');
        push('audio', msg['audio']);
        push('video', msg['video']);
        return list.length ? list : undefined;
    }
    // ------------------------------------------------------------------ send
    async sendMessage(to, content) {
        const url = `${GRAPH_API}/${this.phoneNumberId}/messages`;
        let body;
        if (content.image) {
            body = {
                messaging_product: 'whatsapp',
                to,
                type: 'image',
                image: { link: content.image, ...(content.text ? { caption: content.text } : {}) },
            };
        }
        else if (content.file) {
            body = {
                messaging_product: 'whatsapp',
                to,
                type: 'document',
                document: { link: content.file.url, filename: content.file.filename },
            };
        }
        else {
            body = {
                messaging_product: 'whatsapp',
                to,
                type: 'text',
                text: { body: content.text ?? content.markdown ?? '' },
            };
        }
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`WhatsApp API error ${res.status}: ${err}`);
        }
        this.messagesSent++;
    }
    onMessage(handler) {
        this.messageHandler = handler;
    }
    isConnected() {
        return this.server !== null && this.server.listening;
    }
    getStatus() {
        return {
            connected: this.isConnected(),
            name: this.name,
            uptime: this.isConnected() ? Date.now() - this.connectedAt : 0,
            messagesSent: this.messagesSent,
            messagesReceived: this.messagesReceived,
        };
    }
}
exports.WhatsAppChannel = WhatsAppChannel;
//# sourceMappingURL=whatsapp.js.map