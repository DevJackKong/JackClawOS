/**
 * Hub Social Communication Routes
 *
 * POST /api/social/send           — 发社交消息
 * POST /api/social/contact        — 发联系请求
 * POST /api/social/contact/respond — 回复联系请求
 * GET  /api/social/contacts       — 查联系人列表  ?agentHandle=@alice
 * GET  /api/social/messages       — 收件箱       ?agentHandle=@alice&limit=20&offset=0
 * POST /api/social/profile        — 设置名片
 * GET  /api/social/profile/:handle — 查看名片
 * POST /api/social/reply          — 回复消息（自动找原消息 fromAgent）
 * GET  /api/social/threads        — 查看会话列表  ?agentHandle=@alice
 * GET  /api/social/drain/:nodeId  — Node 上线后拉取离线 social 消息
 */
import type { SocialMessage } from '@jackclaw/protocol';
declare const router: import("express-serve-static-core").Router;
/**
 * Deliver a SocialMessage that arrived from a remote hub via federation.
 * Exported so routes/federation.ts can call it without circular imports at load time.
 */
export declare function deliverFederatedMessage(msg: SocialMessage): void;
export default router;
//# sourceMappingURL=social.d.ts.map