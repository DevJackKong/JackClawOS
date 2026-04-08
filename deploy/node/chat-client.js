"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeChatClient = void 0;
/**
 * NodeChatClient — Node 侧主动连接 Hub ClawChat WebSocket
 * Node 启动后自动连接，接收消息并路由到任务处理器
 *
 * 稳定性特性：
 * - 指数退避重连：1s, 2s, 4s, 8s, 16s, 最大 60s，无限重试
 * - 自动响应 Hub 的 ping（pong），保持心跳
 * - 消息 ACK 机制：发送后等待 ACK，超时自动重试（最多 3 次）
 * - 断线期间消息队列：重连后自动补发
 */
const ws_1 = __importDefault(require("ws"));
const ACK_TIMEOUT_MS = 10_000;
const ACK_MAX_RETRIES = 3;
class NodeChatClient {
    nodeId;
    hubUrl;
    ws = null;
    reconnectCount = 0;
    connected = false;
    handlers = [];
    stopped = false;
    // 断线期间的发送队列（重连后自动补发）
    offlineQueue = [];
    // 等待 ACK 的消息 Map：messageId → PendingAck
    pendingAcks = new Map();
    constructor(nodeId, hubUrl) {
        this.nodeId = nodeId;
        this.hubUrl = hubUrl;
    }
    onMessage(handler) { this.handlers.push(handler); }
    isConnected() { return this.connected; }
    connect() {
        if (this.stopped)
            return;
        const wsUrl = this.hubUrl.replace(/^http/, "ws") + `/chat/ws?nodeId=${encodeURIComponent(this.nodeId)}`;
        console.log(`[chat-client] Connecting to ${wsUrl}`);
        this.ws = new ws_1.default(wsUrl);
        this.ws.on("open", () => {
            console.log("[chat-client] Connected to Hub ClawChat");
            this.reconnectCount = 0;
            this.connected = true;
            // 补发断线期间的离线队列
            if (this.offlineQueue.length > 0) {
                console.log(`[chat-client] Flushing ${this.offlineQueue.length} queued messages`);
                const queued = this.offlineQueue.splice(0);
                for (const payload of queued) {
                    this._rawSend(payload);
                }
            }
        });
        this.ws.on("message", (raw) => {
            try {
                const data = JSON.parse(raw.toString());
                if (data.event === "message") {
                    this.handlers.forEach(h => h(data.data));
                }
                else if (data.event === "ack") {
                    // Hub 确认收到消息，清除 ACK 等待定时器
                    this._clearAck(data.messageId);
                }
                else if (data.event === "inbox") {
                    // 兼容旧版 Hub：inbox 批量推送
                    if (Array.isArray(data.data)) {
                        for (const msg of data.data) {
                            this.handlers.forEach(h => h(msg));
                        }
                    }
                }
            }
            catch { }
        });
        // 响应 Hub 的 ping，保持心跳
        this.ws.on("ping", () => {
            this.ws?.pong();
        });
        this.ws.on("close", () => {
            this.connected = false;
            if (this.stopped)
                return;
            // 指数退避：1s, 2s, 4s, 8s, 16s, 32s, 最大 60s，无限重试
            const delay = Math.min(60_000, 1000 * Math.pow(2, this.reconnectCount++));
            console.log(`[chat-client] Disconnected, reconnecting in ${delay}ms (attempt #${this.reconnectCount})`);
            setTimeout(() => this.connect(), delay);
        });
        this.ws.on("error", err => {
            console.warn("[chat-client] WS error:", err.message);
        });
    }
    /**
     * 发送消息，带 ACK 等待 + 超时重试。
     * 断线时自动加入离线队列，重连后补发。
     */
    send(to, content, type = "human") {
        const id = crypto.randomUUID();
        const payload = JSON.stringify({
            id,
            from: this.nodeId,
            to,
            content,
            type,
            ts: Date.now(),
            signature: '',
            encrypted: false,
        });
        this._rawSend(payload, id);
    }
    /** 内部发送：断开则入队；否则发送并注册 ACK 等待 */
    _rawSend(payload, messageId) {
        if (!this.ws || this.ws.readyState !== ws_1.default.OPEN) {
            this.offlineQueue.push(payload);
            return;
        }
        this.ws.send(payload);
        if (messageId) {
            this._registerAck(messageId, payload, 0);
        }
    }
    /** 注册 ACK 等待，超时后重试 */
    _registerAck(messageId, payload, retries) {
        const timer = setTimeout(() => {
            this.pendingAcks.delete(messageId);
            if (retries < ACK_MAX_RETRIES) {
                console.warn(`[chat-client] ACK timeout for ${messageId}, retry ${retries + 1}/${ACK_MAX_RETRIES}`);
                this._rawSend(payload, messageId);
                this._registerAck(messageId, payload, retries + 1);
            }
            else {
                console.error(`[chat-client] Message ${messageId} dropped after ${ACK_MAX_RETRIES} retries`);
            }
        }, ACK_TIMEOUT_MS);
        this.pendingAcks.set(messageId, { payload, timer, retries });
    }
    /** 收到 ACK 后清除等待定时器 */
    _clearAck(messageId) {
        const pending = this.pendingAcks.get(messageId);
        if (pending) {
            clearTimeout(pending.timer);
            this.pendingAcks.delete(messageId);
        }
    }
    stop() {
        this.stopped = true;
        // 清理所有 ACK 定时器
        for (const { timer } of this.pendingAcks.values()) {
            clearTimeout(timer);
        }
        this.pendingAcks.clear();
        this.ws?.close();
    }
}
exports.NodeChatClient = NodeChatClient;
//# sourceMappingURL=chat-client.js.map