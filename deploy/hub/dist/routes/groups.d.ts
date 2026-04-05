/**
 * Hub Groups & Channels Routes
 *
 * POST   /api/groups/create              — 创建群组/频道
 * GET    /api/groups/list                — 我的群组列表
 * GET    /api/groups/:id                 — 群组详情
 * POST   /api/groups/:id/members        — 添加成员
 * DELETE /api/groups/:id/members/:nodeId — 移除成员
 * PATCH  /api/groups/:id                 — 修改群组信息
 * POST   /api/groups/:id/message        — 发群消息
 * GET    /api/groups/:id/messages       — 群消息历史
 * POST   /api/groups/:id/pin            — 置顶消息
 * POST   /api/groups/join/:inviteCode   — 通过邀请码加入
 *
 * 频道规则：
 *   - type='channel' 时只有 admins 可以发消息
 *   - 普通成员是订阅者（只读）
 *   - replyToId 支持频道消息评论/回复
 *
 * 认证：使用 jwtPayload（由 server.ts 中的 jwtAuthMiddleware 注入）
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=groups.d.ts.map