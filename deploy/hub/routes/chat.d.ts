/**
 * Hub ClawChat 路由
 *
 * POST /chat/send          — 发送消息（Hub 中转或推送）
 * GET  /chat/inbox         — 拉取离线消息
 * GET  /chat/threads       — 获取会话列表
 * GET  /chat/thread/:id    — 获取会话历史
 * POST /chat/thread        — 创建会话
 * POST /chat/group/create  — 创建群组
 * GET  /chat/groups        — 列出我参与的群组
 * POST /chat/human/register — 注册人类账号
 * GET  /chat/humans        — 列出所有人类账号
 * WS   /chat/ws            — WebSocket 实时推送
 *
 * 所有消息处理委托给 ChatWorker；路由只做参数校验。
 */
import type { WebSocketServer } from 'ws';
declare const router: import("express-serve-static-core").Router;
export { router as chatRouter };
/**
 * Push an arbitrary event to a connected node's WebSocket.
 * Used by the social route. Returns false if node is offline.
 */
export declare function pushToNodeWs(nodeId: string, event: string, data: unknown): boolean;
/**
 * Raw WebSocket access for social route offline queueing.
 */
export declare function getNodeWs(nodeId: string): import('ws').WebSocket | undefined;
export declare function attachChatWss(server: import('http').Server): WebSocketServer;
//# sourceMappingURL=chat.d.ts.map