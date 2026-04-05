/**
 * Hub Receipt 路由
 *
 * POST /receipt/delivered   — 标记送达
 * POST /receipt/read        — 标记已读
 * POST /receipt/read-batch  — 批量标记已读
 * POST /receipt/typing      — 发送输入中状态
 * GET  /receipt/status/:messageId — 查询消息状态
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=receipt.d.ts.map