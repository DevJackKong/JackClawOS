"use strict";
/**
 * ClawChat Hub Store — 消息存储、离线队列、会话管理
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatStore = void 0;
const crypto_1 = require("crypto");
const message_store_1 = require("./message-store");
function storedToChat(s) {
    return {
        id: s.id,
        threadId: s.threadId,
        replyToId: s.replyTo,
        from: s.fromAgent,
        to: s.toAgent,
        type: s.type,
        content: s.content,
        attachments: s.attachments,
        ts: s.ts,
        signature: '',
        encrypted: s.encrypted,
    };
}
class ChatStore {
    messages = new Map();
    threads = new Map();
    inbox = new Map();
    groups = new Map();
    // nodeId → 活跃时间统计（轻量观察，不做深度分析）
    activityLog = new Map();
    getMessage(id) {
        return this.messages.get(id);
    }
    saveMessage(msg) {
        this.messages.set(msg.id, msg);
        if (msg.threadId) {
            const thread = this.threads.get(msg.threadId);
            if (thread) {
                thread.lastMessageAt = msg.ts;
                thread.messageCount++;
            }
        }
        // Persist to SQLite / JSONL
        const stored = {
            id: msg.id,
            threadId: msg.threadId,
            fromAgent: msg.from,
            toAgent: Array.isArray(msg.to) ? JSON.stringify(msg.to) : msg.to,
            content: msg.content,
            type: msg.type,
            replyTo: msg.replyToId,
            attachments: msg.attachments,
            status: msg.executionResult?.status ?? 'sent',
            ts: msg.ts,
            encrypted: msg.encrypted,
        };
        try {
            message_store_1.messageStore.saveMessage(stored);
        }
        catch { /* persistence is best-effort */ }
    }
    getThread(threadId) {
        // Try persistent store first; fall back to in-memory
        try {
            const stored = message_store_1.messageStore.getThread(threadId, 200, 0);
            if (stored.length > 0) {
                return stored.map(s => storedToChat(s));
            }
        }
        catch { /* fall through */ }
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
    /** Hub 侧轻量观察：记录活跃时间戳，供 Node 侧 OwnerMemory 消费 */
    observeMessage(nodeId, opts) {
        const log = this.activityLog.get(nodeId) ?? [];
        log.push(Date.now());
        // 只保留最近100条时间戳
        if (log.length > 100)
            log.splice(0, log.length - 100);
        this.activityLog.set(nodeId, log);
    }
    getActivityLog(nodeId) {
        return this.activityLog.get(nodeId) ?? [];
    }
    // ─── 群组管理 ─────────────────────────────────────────────────────────────────
    createGroup(name, members, createdBy, topic) {
        const group = {
            groupId: (0, crypto_1.randomUUID)(),
            name,
            members,
            createdBy,
            createdAt: Date.now(),
            topic,
        };
        this.groups.set(group.groupId, group);
        return group;
    }
    getGroup(groupId) {
        return this.groups.get(groupId) ?? null;
    }
    listGroups(nodeId) {
        return [...this.groups.values()]
            .filter(g => g.members.includes(nodeId))
            .sort((a, b) => b.createdAt - a.createdAt);
    }
}
exports.ChatStore = ChatStore;
//# sourceMappingURL=chat.js.map