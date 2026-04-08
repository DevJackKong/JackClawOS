/**
 * RBAC Roles Routes / RBAC 角色路由
 *
 * POST   /api/roles          — 创建自定义角色 / Create a custom role
 * GET    /api/roles          — 列出租户下所有角色 / List all roles in tenant
 * GET    /api/roles/:id      — 获取单个角色 / Get a single role
 * PATCH  /api/roles/:id      — 更新角色权限 / Update role permissions
 * DELETE /api/roles/:id      — 删除自定义角色 / Delete custom role only
 * POST   /api/roles/assign   — 给用户分配角色 / Assign role to user
 * GET    /api/roles/user/:userId — 获取用户全部角色 / Get all roles for a user
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=roles.d.ts.map