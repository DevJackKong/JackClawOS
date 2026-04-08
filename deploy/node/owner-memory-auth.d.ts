/**
 * OwnerMemory Authorization Layer — 情绪独立区授权框架
 *
 * 核心设计原则：
 * 1. 数据归用户所有，存在本地 Node，不上传任何服务器
 * 2. 第三方产品（硬件/软件）通过 OAuth2-like 授权机制申请访问
 * 3. 授权粒度细化到 MemoryType 级别（只允许读 preference，不允许读 private-note）
 * 4. 授权可随时撤销，撤销后立即生效
 * 5. 所有访问行为审计日志记录
 */
import type { OwnerMemoryType, OwnerMemoryEntry } from './owner-memory';
/** 可授权的 memory 类型（private-note 永远不可授权） */
export type AuthorizableMemoryType = Exclude<OwnerMemoryType, 'private-note'>;
export type AccessScope = 'personality:read' | 'relationship:read' | 'emotional-state:read' | 'preference:read' | 'milestone:read' | 'snapshot:read' | 'stats:read';
/** 产品类型 */
export type ProductType = 'hardware' | 'app' | 'ai-service' | 'analytics';
export interface AuthGrant {
    grantId: string;
    nodeId: string;
    clientId: string;
    clientName: string;
    productType: ProductType;
    scopes: AccessScope[];
    createdAt: number;
    expiresAt: number;
    lastUsedAt?: number;
    accessCount: number;
    active: boolean;
    userNote?: string;
}
export interface AuthRequest {
    clientId: string;
    clientName: string;
    productType: ProductType;
    requestedScopes: AccessScope[];
    reason: string;
    webhookUrl?: string;
}
export interface AccessToken {
    token: string;
    grantId: string;
    scopes: AccessScope[];
    expiresAt: number;
}
export interface AuditLog {
    id: string;
    grantId: string;
    clientId: string;
    clientName: string;
    scope: AccessScope;
    accessedAt: number;
    success: boolean;
    ipHint?: string;
}
export declare class OwnerMemoryAuth {
    private nodeId;
    private storePath;
    private grants;
    private tokens;
    private auditLogs;
    private pendingRequests;
    constructor(nodeId: string, storePath?: string);
    /** 列出所有待审批的授权申请 */
    getPendingRequests(): Array<AuthRequest & {
        requestedAt: number;
        requestId: string;
    }>;
    /** 用户批准授权申请 */
    approve(requestId: string, opts?: {
        scopes?: AccessScope[];
        expiryDays?: number;
        userNote?: string;
    }): AuthGrant;
    /** 撤销授权（立即生效） */
    revoke(grantId: string): void;
    /** 列出所有有效授权 */
    listGrants(): AuthGrant[];
    /** 查看访问日志 */
    getAuditLog(grantId?: string): AuditLog[];
    /** 产品方提交授权申请（返回 requestId，等待用户审批） */
    requestAccess(request: AuthRequest): string;
    /** 用授权凭证换取访问 token（grant_type=client_credentials like） */
    issueToken(grantId: string, clientSecret: string): AccessToken;
    /**
     * 产品方用 token 访问 OwnerMemory 数据
     * 返回脱敏后的数据（不含 private-note，不含原始 ID）
     */
    access(token: string, scope: AccessScope, entries: OwnerMemoryEntry[]): unknown;
    private logAccess;
    private load;
    private save;
}
export declare function getOwnerMemoryAuth(nodeId: string): OwnerMemoryAuth;
//# sourceMappingURL=owner-memory-auth.d.ts.map