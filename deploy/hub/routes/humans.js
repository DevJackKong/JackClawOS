"use strict";
/**
 * /api/humans — 人类账号管理 + 人类直发消息
 *
 * POST /humans/register   — 注册人类账号（humanId, displayName, agentNodeId, webhookUrl）
 * GET  /humans             — 列出所有人类账号
 * POST /humans/message     — 人类直接发消息（humanToken 鉴权，无需 JWT）
 *
 * 消息流转协议（/humans/message）：
 *   Human 发消息 → Hub 检测 to 是否为 humanId
 *     → 是：转给对应 agentNodeId → Agent 处理/转发 → 推送到目标 human webhookUrl
 *     → 否：按普通 agentNodeId 路由（WebSocket / 离线队列）
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = require("crypto");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const server_1 = require("../server");
const human_registry_1 = require("../store/human-registry");
const chat_1 = require("../store/chat");
const router = (0, express_1.Router)();
// 共享同一个 ChatStore 实例
const store = new chat_1.ChatStore();
// ─── JWT helper for admin-only routes ─────────────────────────────────────────
function requireJwt(req, res) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Unauthorized — Bearer token required' });
        return null;
    }
    try {
        const payload = jsonwebtoken_1.default.verify(authHeader.slice(7), server_1.JWT_SECRET, { algorithms: ['HS256'] });
        return payload;
    }
    catch {
        res.status(401).json({ error: 'Invalid or expired token' });
        return null;
    }
}
// ─── POST /humans/register — SECURITY: require JWT ────────────────────────────
router.post('/register', (req, res) => {
    const payload = requireJwt(req, res);
    if (!payload)
        return;
    const { humanId, displayName, agentNodeId, webhookUrl, feishuOpenId } = req.body ?? {};
    if (!humanId || !displayName) {
        res.status(400).json({ error: 'humanId and displayName required' });
        return;
    }
    const human = (0, human_registry_1.registerHuman)({ humanId, displayName, agentNodeId, webhookUrl, feishuOpenId });
    res.json({ status: 'ok', human });
});
// ─── GET /humans — SECURITY: require JWT ──────────────────────────────────────
router.get('/', (req, res) => {
    const payload = requireJwt(req, res);
    if (!payload)
        return;
    res.json({ humans: (0, human_registry_1.listHumans)() });
});
// ─── POST /humans/message — 人类直接发消息（humanToken 鉴权）─────────────────
router.post('/message', async (req, res) => {
    // 鉴权：Authorization: HumanToken <token>
    const authHeader = req.headers.authorization ?? '';
    const token = authHeader.startsWith('HumanToken ')
        ? authHeader.slice('HumanToken '.length).trim()
        : null;
    if (!token) {
        res.status(401).json({ error: 'Missing or invalid Authorization header. Use: HumanToken <token>' });
        return;
    }
    const sender = (0, human_registry_1.getHumanByToken)(token);
    if (!sender) {
        res.status(401).json({ error: 'Invalid humanToken' });
        return;
    }
    // 更新 lastSeenAt
    sender.lastSeenAt = Date.now();
    const { to, content, type = 'human', threadId, replyToId, metadata } = req.body ?? {};
    if (!to || !content) {
        res.status(400).json({ error: 'to and content required' });
        return;
    }
    const msg = {
        id: (0, crypto_1.randomUUID)(),
        from: sender.humanId,
        to,
        content,
        type,
        ts: Date.now(),
        signature: '',
        encrypted: false,
        ...(threadId && { threadId }),
        ...(replyToId && { replyToId }),
        ...(metadata && { metadata }),
    };
    store.saveMessage(msg);
    // 路由：to 为 humanId → 通过目标的 agentNodeId 中转；否则直接路由到 agentNodeId
    const targets = Array.isArray(to) ? to : [to];
    const routed = [];
    const direct = [];
    for (const target of targets) {
        if ((0, human_registry_1.isHumanTarget)(target)) {
            const targetHuman = (0, human_registry_1.getHuman)(target);
            if (!targetHuman)
                continue;
            if (targetHuman.agentNodeId) {
                // 通过目标 Agent 中转
                const agentPayload = {
                    ...msg,
                    to: targetHuman.agentNodeId,
                    metadata: {
                        ...msg.metadata,
                        humanTarget: targetHuman.humanId,
                        humanDisplayName: targetHuman.displayName,
                    },
                };
                store.queueForOffline(targetHuman.agentNodeId, agentPayload);
                routed.push(target);
            }
            else if (targetHuman.webhookUrl) {
                // 无 Agent，直接 webhook（兜底）
                await (0, human_registry_1.pushToHuman)(targetHuman, { from: msg.from, content: msg.content, type: msg.type, id: msg.id });
                direct.push(target);
            }
        }
        else {
            // 目标是 agentNodeId：走离线队列（WebSocket 连接由 chat.ts 管理）
            store.queueForOffline(target, msg);
            direct.push(target);
        }
    }
    res.json({
        status: 'ok',
        messageId: msg.id,
        routed, // 通过 agentNodeId 中转
        direct, // 直接推送 / 离线队列
    });
});
exports.default = router;
//# sourceMappingURL=humans.js.map