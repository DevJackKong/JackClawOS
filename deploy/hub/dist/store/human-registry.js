"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerHuman = registerHuman;
exports.getHumanByToken = getHumanByToken;
exports.getHuman = getHuman;
exports.listHumans = listHumans;
exports.isHumanTarget = isHumanTarget;
exports.pushToHuman = pushToHuman;
const crypto_1 = require("crypto");
const humans = new Map();
function registerHuman(account) {
    // Reuse existing token if re-registering
    const existing = humans.get(account.humanId);
    const humanToken = existing?.humanToken ?? (0, crypto_1.randomUUID)();
    const h = { ...account, humanToken, registeredAt: Date.now() };
    humans.set(account.humanId, h);
    return h;
}
function getHumanByToken(token) {
    for (const h of humans.values()) {
        if (h.humanToken === token)
            return h;
    }
    return undefined;
}
function getHuman(humanId) {
    return humans.get(humanId);
}
function listHumans() {
    return [...humans.values()];
}
/**
 * 判断一个 target 是人类账号还是 Agent Node
 * 约定：humanId 以 "h:" 开头，或已注册到 HumanRegistry
 */
function isHumanTarget(target) {
    return target.startsWith('h:') || humans.has(target);
}
/**
 * 把消息推送到人类账号的设备
 * 支持：webhook（任意 HTTP 端点）| 飞书（后续扩展）
 */
async function pushToHuman(human, message) {
    if (human.webhookUrl) {
        try {
            await fetch(human.webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ event: 'message', data: message }),
                signal: AbortSignal.timeout(5000),
            });
        }
        catch (e) {
            console.warn(`[human-registry] Push to ${human.humanId} failed:`, e.message);
        }
    }
    // feishu 推送 — 通过 JACKCLAW_HUB 的 feishu channel 路由（未来扩展）
}
//# sourceMappingURL=human-registry.js.map