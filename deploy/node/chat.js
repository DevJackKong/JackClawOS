"use strict";
/**
 * ClawChat — JackClaw 原生消息通道
 *
 * 人↔Agent↔人 的 IM 系统，内置于 JackClaw 网络。
 * 消息即指令：type='task' 直接触发 Agent 执行。
 * E2E 加密，离线队列，WebSocket 实时推送。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatStore = void 0;
exports.buildChatMessage = buildChatMessage;
exports.decryptChatMessage = decryptChatMessage;
exports.verifyChatMessage = verifyChatMessage;
const crypto_1 = require("crypto");
const protocol_1 = require("@jackclaw/protocol");
// ─── 消息存储 ────────────────────────────────────────────────────────────────
class ChatStore {
    messages = new Map();
    threads = new Map();
    inbox = new Map(); // nodeId → 未读消息队列（离线暂存）
    saveMessage(msg) {
        this.messages.set(msg.id, msg);
        // 更新 thread
        if (msg.threadId) {
            const thread = this.threads.get(msg.threadId);
            if (thread) {
                thread.lastMessageAt = msg.ts;
                thread.messageCount++;
            }
        }
    }
    getThread(threadId) {
        return [...this.messages.values()]
            .filter(m => m.threadId === threadId)
            .sort((a, b) => a.ts - b.ts);
    }
    getInbox(nodeId) {
        return this.inbox.get(nodeId) ?? [];
    }
    queueForOffline(nodeId, msg) {
        const q = this.inbox.get(nodeId) ?? [];
        q.push(msg);
        this.inbox.set(nodeId, q);
    }
    drainInbox(nodeId) {
        const msgs = this.inbox.get(nodeId) ?? [];
        this.inbox.delete(nodeId);
        return msgs;
    }
    createThread(participants, title) {
        const thread = {
            id: (0, crypto_1.randomUUID)(),
            participants,
            title,
            createdAt: Date.now(),
            lastMessageAt: Date.now(),
            messageCount: 0,
        };
        this.threads.set(thread.id, thread);
        return thread;
    }
    listThreads(nodeId) {
        return [...this.threads.values()]
            .filter(t => t.participants.includes(nodeId))
            .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    }
}
exports.ChatStore = ChatStore;
// ─── 消息构建 ─────────────────────────────────────────────────────────────────
function buildChatMessage(opts) {
    const { identity, recipientPublicKey, ...rest } = opts;
    let content = opts.content;
    let encrypted = false;
    if (recipientPublicKey && typeof opts.to === 'string') {
        // 单对单：E2E 加密
        const enc = (0, protocol_1.encrypt)(content, recipientPublicKey);
        content = JSON.stringify(enc);
        encrypted = true;
    }
    const msg = {
        id: (0, crypto_1.randomUUID)(),
        threadId: opts.threadId,
        replyToId: opts.replyToId,
        from: opts.from,
        to: opts.to,
        type: opts.type,
        content,
        attachments: opts.attachments,
        ts: Date.now(),
        encrypted,
    };
    const signature = (0, protocol_1.sign)(JSON.stringify(msg), identity.privateKey);
    return { ...msg, signature };
}
function decryptChatMessage(msg, recipientPrivateKey) {
    if (!msg.encrypted)
        return msg.content;
    const enc = JSON.parse(msg.content);
    return (0, protocol_1.decrypt)(enc, recipientPrivateKey);
}
function verifyChatMessage(msg, senderPublicKey) {
    const { signature, ...rest } = msg;
    return (0, protocol_1.verify)(JSON.stringify(rest), signature, senderPublicKey);
}
//# sourceMappingURL=chat.js.map