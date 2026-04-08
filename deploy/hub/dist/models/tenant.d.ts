/**
 * Tenant / 租户
 */
export interface Tenant {
    id: string;
    name: string;
    slug: string;
    plan: 'free' | 'pro' | 'enterprise';
    status: 'active' | 'suspended' | 'deleted';
    createdAt: number;
    updatedAt: number;
    settings: Record<string, unknown>;
}
/**
 * Organization / 组织
 */
export interface Organization {
    id: string;
    tenantId: string;
    name: string;
    slug: string;
    createdAt: number;
    updatedAt: number;
}
/**
 * Workspace / 工作区
 */
export interface Workspace {
    id: string;
    orgId: string;
    tenantId: string;
    name: string;
    slug: string;
    createdAt: number;
    updatedAt: number;
}
/**
 * Member / 成员
 */
export interface Member {
    id: string;
    tenantId: string;
    orgId: string;
    userId: string;
    role: string;
    status: 'active' | 'invited' | 'disabled';
    joinedAt: number;
    updatedAt: number;
}
//# sourceMappingURL=tenant.d.ts.map