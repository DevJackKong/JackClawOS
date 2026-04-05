/**
 * Hub Task Routes — /api/tasks
 *
 * Proxy task requests to nodes and track task state in memory.
 *
 * POST   /api/tasks/submit        — 提交任务到指定 Node（或自动选择）
 * GET    /api/tasks/:id           — 查询任务状态
 * GET    /api/tasks/list          — 任务列表
 * POST   /api/tasks/:id/cancel    — 取消任务
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=tasks.d.ts.map