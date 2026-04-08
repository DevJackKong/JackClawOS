/**
 * Watchdog Hub Routes
 *
 * POST /api/watchdog/heartbeat       — 节点心跳上报（健康指标）
 * GET  /api/watchdog/status          — 所有节点健康状态
 * GET  /api/watchdog/status/:nodeId  — 单节点健康状态
 * POST /api/watchdog/policy       — 添加监督策略（需要 target 节点授权签名）
 * GET  /api/watchdog/alerts/:nodeId — 查询告警
 * POST /api/watchdog/ack/:eventId  — 真人确认告警（需要特殊 human-token）
 * GET  /api/watchdog/snapshot/:nodeId — 获取最新快照
 *
 * 安全约束：
 *  - addPolicy 需验证 target 签名（防止 Agent 擅自建立监督关系）
 *  - ack 接口只允许携带 X-Human-Token 的请求（机器人 JWT 被拒绝）
 *  - Agent 无法关闭告警（canModify() 始终 false）
 */
declare const router: import("express-serve-static-core").Router;
interface HeartbeatMetrics {
    memUsage: number;
    cpuLoad: number;
    uptime: number;
    tasksCompleted: number;
    lastTaskAt: number;
}
interface WatchdogEntry {
    nodeId: string;
    status: 'online' | 'offline';
    lastHeartbeat: number;
    metrics: HeartbeatMetrics;
}
declare const heartbeatStore: Map<string, WatchdogEntry>;
declare function resolveStatus(entry: WatchdogEntry): WatchdogEntry;
export { heartbeatStore, resolveStatus };
export type { WatchdogEntry };
export default router;
//# sourceMappingURL=watchdog.d.ts.map