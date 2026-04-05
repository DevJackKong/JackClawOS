/**
 * User Authentication Routes
 *
 * POST /api/auth/register        — 注册（若 Hub 开启 requireInvite，需要邀请码）
 * POST /api/auth/login           — 登录
 * GET  /api/auth/me              — 当前用户 (JWT Bearer)
 * PATCH /api/auth/profile        — 更新资料 (JWT Bearer)
 * POST /api/auth/change-password — 修改密码 (JWT Bearer)
 * POST /api/auth/check-handle    — 检查 @handle 可用性 (无需认证)
 * GET  /api/auth/users           — 用户列表 (JWT Bearer, admin only)
 * POST /api/auth/invite          — 生成邀请码 (CEO/admin only)
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=auth.d.ts.map