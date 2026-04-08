/**
 * Node Social Handler
 *
 * 处理 Hub 通过 WebSocket 推送的 social 事件：
 * - 'social'                 — 收到社交消息
 * - 'social_contact_request' — 收到联系请求
 * - 'social_contact_response'— 联系请求结果
 *
 * 主人回复通过 Hub /api/social/reply 转发
 */
import type { SocialMessage } from '@jackclaw/protocol';
import type { AiClient } from './ai-client';
import type { OwnerMemory } from './owner-memory';
export interface SocialHandlerOptions {
    nodeId: string;
    agentHandle?: string;
    hubUrl: string;
    /** 主人的 webhook URL，有则推送通知 */
    webhookUrl?: string;
    /** 主人 humanId，用于推送目标 */
    humanId?: string;
    /** AiClient 实例，用于翻译 */
    aiClient?: AiClient;
    /** OwnerMemory 实例，用于记录情绪模式 */
    ownerMemory?: OwnerMemory;
    /** Auth token for Hub API */
    token?: string;
}
export declare class SocialHandler {
    private opts;
    private readonly filter;
    private readonly emotion;
    constructor(opts: SocialHandlerOptions);
    /** 处理 WebSocket 收到的事件 */
    handleEvent(event: string, data: unknown): void;
    private _onSocialMessage;
    /** 根据情绪返回给主人的提示文字 */
    private _emotionHint;
    /** Handle messages with type='task' by delegating to TaskExecutor and auto-replying */
    private _handleTaskMessage;
    private _onContactRequest;
    private _onContactResponse;
    /**
     * 主人通过 webhookUrl 的推送（fire-and-forget）
     */
    private _pushToOwner;
    /**
     * 主人回复某条社交消息（通过 Hub /api/social/reply 转发）
     * 如果对方语言与主人语言不同，且 autoTranslate 开启，自动翻译后发送
     */
    ownerReply(opts: {
        replyToId: string;
        content: string;
        fromHuman: string;
        fromAgent: string;
        /** 对方原始消息，用于检测对方语言并自动翻译主人回复 */
        originalMessage?: SocialMessage;
    }): Promise<void>;
}
//# sourceMappingURL=social-handler.d.ts.map