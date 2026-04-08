/**
 * AiConcierge — AI 代办
 *
 * 功能：
 *   - 日程协商：解析自然语言时间，与对方 Agent 协商可用时段
 *   - 任务提醒：创建/查看/取消到期提醒，定时检查触发
 *
 * 存储：~/.jackclaw/node/concierge.json
 * 通信：通过 Hub /api/social/send 发送协商消息
 */
import type { Reminder } from '@jackclaw/protocol';
export declare class AiConcierge {
    private nodeId;
    private hubUrl;
    private agentHandle;
    private token?;
    constructor(opts: {
        nodeId: string;
        hubUrl: string;
        agentHandle?: string;
        token?: string;
    });
    /**
     * 发起日程协商：
     *   1. 解析自然语言时间
     *   2. 生成候选时间列表（目标时间 + 备选）
     *   3. 通过 Hub 发送协商消息给对方 Agent
     *   4. 本地记录 pending 请求
     */
    scheduleNegotiation(withAgent: string, request: string): Promise<{
        requestId: string;
        proposedTimes: number[];
        message: string;
    }>;
    /**
     * 处理对方 Agent 发来的协商消息（来自 Hub WebSocket social 事件）。
     * - 若为 schedule_request → 自动选第一个时间回复，并创建提醒
     * - 若为 schedule_response → 记录结果，创建提醒
     */
    handleNegotiationResponse(msg: {
        type?: string;
        content: string;
        fromAgent?: string;
    }): void;
    createReminder(time: number, message: string): Reminder;
    listReminders(): Reminder[];
    cancelReminder(id: string): boolean;
    /**
     * 检查到期提醒（每分钟调用一次），触发并标记已触发。
     */
    checkReminders(): void;
    private _sendSocial;
    private _load;
    private _save;
}
export declare function createConcierge(opts: {
    nodeId: string;
    hubUrl: string;
    agentHandle?: string;
    token?: string;
}): AiConcierge;
export declare function getConcierge(): AiConcierge | null;
//# sourceMappingURL=ai-concierge.d.ts.map