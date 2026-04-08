import type { LLMGateway } from '@jackclaw/llm-gateway';
export interface AutoReplyOptions {
    nodeId: string;
    hubUrl: string;
    /** LLM 角色定义，注入为 system message */
    systemPrompt?: string;
    /** 模型名称，透传给 Gateway；默认 claude-3-5-haiku-20241022 */
    model?: string;
    /** 可选：传入已初始化的 LLMGateway 实例 */
    llmGateway?: LLMGateway;
    /** 可选：OpenClaw Gateway 兼容接口 URL（/v1/chat/completions） */
    openclawGatewayUrl?: string;
    /** 可选：API Key，用于 Authorization: Bearer 头（OpenAI / Anthropic road2all 等） */
    apiKey?: string;
    /** 对话历史保留条数，默认 20 */
    historyLimit?: number;
}
export declare class AutoReplyHandler {
    private ws;
    private reconnectCount;
    private stopped;
    private connected;
    private history;
    private readonly nodeId;
    private readonly hubUrl;
    private readonly systemPrompt;
    private readonly model;
    private readonly llmGateway?;
    private readonly openclawGatewayUrl?;
    private readonly apiKey?;
    private readonly historyLimit;
    constructor(opts: AutoReplyOptions);
    /** 连接 Hub WebSocket，开始监听并自动回复 */
    start(): void;
    stop(): void;
    isConnected(): boolean;
    private _connect;
    private _handleMessage;
    private _generateReply;
    /** 通过 LLMGateway 实例调用 */
    private _callGateway;
    /** 通过 OpenClaw Gateway HTTP /v1/chat/completions 调用 */
    private _callOpenClawHttp;
    private _sendReply;
    /** 保持历史在 historyLimit 条以内（成对 user+assistant） */
    private _trimHistory;
    /** 清除对话历史（外部可调用，例如开始新对话时） */
    clearHistory(): void;
}
//# sourceMappingURL=auto-reply.d.ts.map