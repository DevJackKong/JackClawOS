/**
 * Hub Plan Route — CEO 侧任务规划
 * POST /api/plan/estimate
 * 把规划请求转发给指定 Node，返回 ExecutionPlan
 * 如果没有指定 Node，使用启发式规则本地估算
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=plan.d.ts.map