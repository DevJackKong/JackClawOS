/**
 * /api/task-state — Task state routes / 任务状态路由
 *
 * POST   /                — Create task / 创建任务
 * GET    /                — List tasks / 列出任务
 * GET    /:id             — Get one task / 获取单个任务
 * PATCH  /:id             — Update task metadata / 更新任务元数据
 * POST   /:id/transition  — Transition task state / 执行状态转换
 * POST   /:id/assign      — Assign task / 分配任务
 * GET    /:id/history     — Get transition history / 获取状态变更历史
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=task-state.d.ts.map