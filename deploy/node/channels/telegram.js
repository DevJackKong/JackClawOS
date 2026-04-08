"use strict";
/**
 * telegram.ts — Telegram Bot API channel adapter for ClawChat bridge
 *
 * Uses Node.js native fetch (Node 18+). No npm dependencies.
 * Long polling via getUpdates with timeout=30 for near-realtime delivery.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelegramChannel = void 0;
const TELEGRAM_API = 'https://api.telegram.org';
/** Escape special chars for Telegram MarkdownV2 */
function escapeMarkdownV2(text) {
    // Characters that must be escaped in MarkdownV2 outside of code/pre blocks
    return text.replace(/([_*[\]()~`>#+=|{}.!\\-])/g, '\\$1');
}
/**
 * Convert simple Markdown to Telegram MarkdownV2.
 * Handles: **bold**, *italic*, `code`, ```pre```, [text](url)
 * Falls back to escaping unsupported constructs.
 */
function toMarkdownV2(md) {
    return md
        // fenced code blocks — keep as-is inside ```
        .replace(/```([\s\S]*?)```/g, (_, code) => '```' + code + '```')
        // inline code
        .replace(/`([^`]+)`/g, (_, code) => '`' + code + '`')
        // bold **text** or __text__
        .replace(/\*\*(.+?)\*\*/g, (_, t) => '*' + escapeMarkdownV2(t) + '*')
        .replace(/__(.+?)__/g, (_, t) => '*' + escapeMarkdownV2(t) + '*')
        // italic *text* or _text_
        .replace(/\*(.+?)\*/g, (_, t) => '_' + escapeMarkdownV2(t) + '_')
        .replace(/_(.+?)_/g, (_, t) => '_' + escapeMarkdownV2(t) + '_')
        // links [text](url)
        .replace(/\[(.+?)\]\((.+?)\)/g, (_, text, url) => `[${escapeMarkdownV2(text)}](${url})`)
        // escape remaining special chars in plain text segments
        .replace(/(?<![\\\*_`\[\(])([>#+\-=|{}.!])/g, '\\$1');
}
class TelegramChannel {
    name = 'telegram';
    token = '';
    polling = false;
    offset = 0;
    messageHandler = null;
    connectedAt = 0;
    messagesSent = 0;
    messagesReceived = 0;
    // ------------------------------------------------------------------ helpers
    apiUrl(method) {
        return `${TELEGRAM_API}/bot${this.token}/${method}`;
    }
    async apiGet(method, params = {}) {
        const url = new URL(this.apiUrl(method));
        for (const [k, v] of Object.entries(params))
            url.searchParams.set(k, String(v));
        const res = await fetch(url.toString());
        const json = (await res.json());
        if (!json.ok)
            throw new Error(`Telegram API error [${method}]: ${json.description}`);
        return json.result;
    }
    async apiPost(method, body) {
        const res = await fetch(this.apiUrl(method), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const json = (await res.json());
        if (!json.ok)
            throw new Error(`Telegram API error [${method}]: ${json.description}`);
        return json.result;
    }
    // ------------------------------------------------------------------ polling
    async poll() {
        while (this.polling) {
            try {
                const updates = await this.apiGet('getUpdates', {
                    offset: this.offset,
                    timeout: 30,
                });
                for (const update of updates) {
                    this.offset = update.update_id + 1;
                    try {
                        this.handleUpdate(update);
                    }
                    catch (e) {
                        console.error('[TelegramChannel] handleUpdate error:', e);
                    }
                }
            }
            catch (e) {
                if (!this.polling)
                    break;
                console.error('[TelegramChannel] getUpdates error, retrying in 5s:', e);
                await new Promise(r => setTimeout(r, 5000));
            }
        }
    }
    // ------------------------------------------------------------------ Channel interface
    async connect(config) {
        if (!config.token)
            throw new Error('TelegramChannel: token is required');
        this.token = config.token;
        this.polling = true;
        this.connectedAt = Date.now();
        // Verify token + fetch bot info
        await this.apiGet('getMe');
        // Start polling in background — do not await
        this.poll().catch(e => console.error('[TelegramChannel] poll fatal:', e));
    }
    async disconnect() {
        this.polling = false;
    }
    async sendMessage(target, content) {
        const chatId = target;
        if (content.image) {
            const caption = content.text ?? content.markdown;
            await this.apiPost('sendPhoto', {
                chat_id: chatId,
                photo: content.image,
                ...(caption ? { caption } : {}),
            });
        }
        else if (content.file) {
            await this.apiPost('sendDocument', {
                chat_id: chatId,
                document: content.file.url,
                caption: content.file.filename,
            });
        }
        else if (content.markdown) {
            await this.apiPost('sendMessage', {
                chat_id: chatId,
                text: toMarkdownV2(content.markdown),
                parse_mode: 'MarkdownV2',
                ...(content.replyTo ? { reply_to_message_id: content.replyTo } : {}),
            });
        }
        else if (content.text) {
            await this.apiPost('sendMessage', {
                chat_id: chatId,
                text: content.text,
                ...(content.replyTo ? { reply_to_message_id: content.replyTo } : {}),
            });
        }
        this.messagesSent++;
    }
    onMessage(handler) {
        this.messageHandler = handler;
    }
    isConnected() {
        return this.polling;
    }
    getStatus() {
        return {
            connected: this.polling,
            name: this.name,
            uptime: this.polling ? Date.now() - this.connectedAt : 0,
            messagesSent: this.messagesSent,
            messagesReceived: this.messagesReceived,
        };
    }
    // ------------------------------------------------------------------ update parsing
    handleUpdate(update) {
        const msg = update.message ?? update.edited_message ?? update.channel_post;
        if (!msg || !this.messageHandler)
            return;
        const sender = msg.from;
        const chat = msg.chat;
        const attachments = [];
        // Highest-res photo
        if (msg.photo?.length) {
            const photo = msg.photo[msg.photo.length - 1];
            attachments.push({
                type: 'photo',
                url: `tg://file/${photo.file_id}`,
            });
        }
        if (msg.document) {
            attachments.push({
                type: 'document',
                url: `tg://file/${msg.document.file_id}`,
                filename: msg.document.file_name,
            });
        }
        if (msg.voice) {
            attachments.push({
                type: 'voice',
                url: `tg://file/${msg.voice.file_id}`,
            });
        }
        const incoming = {
            channel: this.name,
            senderId: String(sender?.id ?? chat.id),
            senderName: sender
                ? [sender.first_name, sender.last_name].filter(Boolean).join(' ')
                : chat.title ?? String(chat.id),
            chatId: String(chat.id),
            chatType: chat.type === 'private' ? 'direct' : 'group',
            content: msg.text ?? msg.caption ?? '',
            attachments: attachments.length ? attachments : undefined,
            replyTo: msg.reply_to_message
                ? String(msg.reply_to_message.message_id)
                : undefined,
            ts: msg.date * 1000,
            raw: update,
        };
        this.messagesReceived++;
        this.messageHandler(incoming);
    }
}
exports.TelegramChannel = TelegramChannel;
//# sourceMappingURL=telegram.js.map