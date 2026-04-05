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
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=humans.d.ts.map