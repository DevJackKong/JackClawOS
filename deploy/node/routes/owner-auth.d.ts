/**
 * OwnerMemory 授权区路由
 *
 * 主人视角（无需 token）：
 *   GET  /api/owner/snapshot      — 情绪快照
 *   GET  /api/owner/stats         — 关系统计
 *   GET  /api/owner/auth/pending  — 待审批申请
 *   POST /api/owner/auth/approve  — 批准申请
 *   POST /api/owner/auth/revoke   — 撤销授权
 *   GET  /api/owner/auth/grants   — 所有有效授权
 *   GET  /api/owner/auth/audit    — 访问日志
 *
 * 第三方产品侧：
 *   POST /api/owner/auth/request  — 申请授权
 *   POST /api/owner/auth/token    — 换取 access token
 *   GET  /api/owner/data/:scope   — 用 token 读取授权数据
 */
import { Router } from 'express';
import type { NodeIdentity } from '@jackclaw/protocol';
export declare function createOwnerAuthRouter(identity: NodeIdentity): Router;
//# sourceMappingURL=owner-auth.d.ts.map