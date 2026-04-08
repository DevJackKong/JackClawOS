import { Tenant, Organization, Workspace } from '../models/tenant';
export interface TenantRecord extends Tenant {
    organizations: Organization[];
    workspaces: Workspace[];
}
export interface TenantUpdates {
    name?: string;
    slug?: string;
    plan?: Tenant['plan'];
    status?: Tenant['status'];
    settings?: Record<string, unknown>;
}
export declare class TenantStore {
    private load;
    private save;
    /**
     * Create tenant with default organization and workspace.
     * 创建租户时自动生成默认组织和默认工作区。
     */
    create(name: string, slug: string, plan: Tenant['plan']): TenantRecord;
    /**
     * Get tenant by id.
     * 按 id 获取租户。
     */
    get(id: string): TenantRecord | null;
    /**
     * List all tenants.
     * 获取全部租户列表。
     */
    list(): TenantRecord[];
    /**
     * Update tenant fields.
     * 更新租户基础字段。
     */
    update(id: string, updates: TenantUpdates): TenantRecord | null;
    /**
     * Delete tenant from store.
     * 从存储中删除租户。
     */
    delete(id: string): boolean;
}
export declare const tenantStore: TenantStore;
//# sourceMappingURL=tenant-store.d.ts.map