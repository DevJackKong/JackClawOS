"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutoReplyHandler = void 0;
/**
 * AutoReplyHandler — Node 收到 ClawChat 消息后自动调 LLM 生成回复
 *
 * 使用方式：
 *   const handler = new AutoReplyHandler({
 *     nodeId: "cto-agent",
 *     hubUrl: "http://localhost:3100",
 *     systemPrompt: "你是 CTO，负责技术架构决策",
 *     model: "claude-3-5-sonnet-20241022",
 *     llmGateway: gateway,           // 可选，传入已有 LLMGateway 实例
 *     openclawGatewayUrl: "http://...", // 可选，调 OpenClaw Gateway /v1/chat/completions
 *   })
 *   handler.start()
 *   handler.stop()
 */
const ws_1 = __importDefault(require("ws"));
const DEFAULT_MODEL = 'claude-3-5-haiku-20241022';
const DEFAULT_HISTORY_LIMIT = 20;
class AutoReplyHandler {
    ws = null;
    reconnectCount = 0;
    stopped = false;
    connected = false;
    // 对话历史（user/assistant 交替），不含 system
    history = [];
    nodeId;
    hubUrl;
    systemPrompt;
    model;
    llmGateway;
    openclawGatewayUrl;
    apiKey;
    historyLimit;
    constructor(opts) {
        this.nodeId = opts.nodeId;
        this.hubUrl = opts.hubUrl;
        this.systemPrompt = opts.systemPrompt ?? '你是一个智能 AI 助手，请友好、简洁地回复用户消息。';
        this.model = opts.model ?? DEFAULT_MODEL;
        this.llmGateway = opts.llmGateway;
        this.openclawGatewayUrl = opts.openclawGatewayUrl;
        this.apiKey = opts.apiKey;
        this.historyLimit = opts.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    }
    /** 连接 Hub WebSocket，开始监听并自动回复 */
    start() {
        if (this.stopped)
            return;
        this._connect();
    }
    stop() {
        this.stopped = true;
        this.ws?.close();
        this.ws = null;
    }
    isConnected() { return this.connected; }
    // ── WebSocket ──────────────────────────────────────────────────────
    _connect() {
        const wsUrl = this.hubUrl.replace(/^http/, 'ws') + `/chat/ws?nodeId=${encodeURIComponent(this.nodeId)}`;
        console.log(`[auto-reply] Connecting to ${wsUrl}`);
        this.ws = new ws_1.default(wsUrl);
        this.ws.on('open', () => {
            console.log('[auto-reply] Connected to Hub ClawChat');
            this.reconnectCount = 0;
            this.connected = true;
        });
        this.ws.on('message', (raw) => {
            try {
                const data = JSON.parse(raw.toString());
                if (data.event === 'message') {
                    this._handleMessage(data.data);
                }
                else if (data.event === 'inbox' && Array.isArray(data.data)) {
                    for (const msg of data.data) {
                        this._handleMessage(msg);
                    }
                }
            }
            catch { /* ignore malformed frames */ }
        });
        this.ws.on('ping', () => { this.ws?.pong(); });
        this.ws.on('close', () => {
            this.connected = false;
            if (this.stopped)
                return;
            const delay = Math.min(60_000, 1_000 * Math.pow(2, this.reconnectCount++));
            console.log(`[auto-reply] Disconnected, reconnecting in ${delay}ms (#${this.reconnectCount})`);
            setTimeout(() => this._connect(), delay);
        });
        this.ws.on('error', (err) => {
            console.warn('[auto-reply] WS error:', err.message);
        });
    }
    // ── Message routing ───────────────────────────────────────────────
    _handleMessage(msg) {
        // 忽略自己发出的消息（避免回响循环）
        if (msg.from === this.nodeId)
            return;
        // 只处理发给自己的普通消息
        if (msg.to !== this.nodeId)
            return;
        console.log(`[auto-reply] ← ${msg.from}: ${msg.content.slice(0, 80)}`);
        // 追加用户消息到历史
        this.history.push({ role: 'user', content: msg.content });
        this._trimHistory();
        this._generateReply(msg.content)
            .then((reply) => {
            // 追加 assistant 回复到历史
            this.history.push({ role: 'assistant', content: reply });
            this._trimHistory();
            this._sendReply(msg.from, reply);
        })
            .catch((err) => {
            console.error('[auto-reply] LLM error:', err.message);
        });
    }
    // ── LLM 调用 ─────────────────────────────────────────────────────
    async _generateReply(userContent) {
        // 优先级 1：传入的 LLMGateway 实例
        if (this.llmGateway) {
            return this._callGateway(this.llmGateway);
        }
        // 优先级 2：OpenClaw Gateway HTTP 接口
        if (this.openclawGatewayUrl) {
            return this._callOpenClawHttp();
        }
        // 优先级 3：Echo 回复（用于测试/无 LLM 环境）
        return `[echo] 收到：${userContent}`;
    }
    /** 通过 LLMGateway 实例调用 */
    async _callGateway(gateway) {
        const messages = [
            { role: 'system', content: this.systemPrompt },
            ...this.history,
        ];
        const resp = await gateway.chat({ model: this.model, messages });
        return resp.choices?.[0]?.message?.content ?? '';
    }
    /** 通过 OpenClaw Gateway HTTP /v1/chat/completions 调用 */
    async _callOpenClawHttp() {
        const messages = [
            { role: 'system', content: this.systemPrompt },
            ...this.history,
        ];
        const headers = { 'Content-Type': 'application/json' };
        if (this.apiKey)
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        const res = await fetch(`${this.openclawGatewayUrl.replace(/\/$/, '')}/v1/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ model: this.model, messages }),
        });
        if (!res.ok) {
            throw new Error(`OpenClaw Gateway HTTP ${res.status}: ${await res.text()}`);
        }
        const json = await res.json();
        return json.choices?.[0]?.message?.content ?? '';
    }
    // ── Send reply ────────────────────────────────────────────────────
    _sendReply(to, content) {
        const id = crypto.randomUUID();
        const payload = JSON.stringify({
            id,
            from: this.nodeId,
            to,
            content,
            type: 'human',
            ts: Date.now(),
            signature: '',
            encrypted: false,
        });
        if (this.ws?.readyState === ws_1.default.OPEN) {
            this.ws.send(payload);
            console.log(`[auto-reply] → ${to}: ${content.slice(0, 80)}`);
        }
        else {
            console.warn('[auto-reply] Cannot send — WS not open');
        }
    }
    // ── History management ────────────────────────────────────────────
    /** 保持历史在 historyLimit 条以内（成对 user+assistant） */
    _trimHistory() {
        while (this.history.length > this.historyLimit) {
            this.history.shift();
        }
    }
    /** 清除对话历史（外部可调用，例如开始新对话时） */
    clearHistory() {
        this.history = [];
    }
}
exports.AutoReplyHandler = AutoReplyHandler;
//# sourceMappingURL=auto-reply.js.map