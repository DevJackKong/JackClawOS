/**
 * Human Registry — 人类账号 ↔ 设备推送映射
 *
 * 解决场景：
 * 一条消息发给 ["bob-human", "bob-node"]
 * - bob-node → AI Agent 处理（ClawChat WebSocket）
 * - bob-human → 推送到 Bob 的设备（飞书/ClawChat App/手机）
 *
 * Human 注册时提供 webhookUrl（或 OpenClaw nodeId），
 * Hub 收到 to 包含 humanId 的消息时，通过 webhook 推送
 */
export interface HumanAccount {
    humanId: string;
    displayName: string;
    agentNodeId?: string;
    webhookUrl?: string;
    feishuOpenId?: string;
    humanToken: string;
    registeredAt: number;
    lastSeenAt?: number;
}
export declare function registerHuman(account: Omit<HumanAccount, 'registeredAt' | 'humanToken'>): HumanAccount;
export declare function getHumanByToken(token: string): HumanAccount | undefined;
export declare function getHuman(humanId: string): HumanAccount | undefined;
export declare function listHumans(): HumanAccount[];
/**
 * 判断一个 target 是人类账号还是 Agent Node
 * 约定：humanId 以 "h:" 开头，或已注册到 HumanRegistry
 */
export declare function isHumanTarget(target: string): boolean;
/**
 * 把消息推送到人类账号的设备
 * 支持：webhook（任意 HTTP 端点）| 飞书（后续扩展）
 */
export declare function pushToHuman(human: HumanAccount, message: {
    from: string;
    content: string;
    type: string;
    id: string;
}): Promise<void>;
//# sourceMappingURL=human-registry.d.ts.map