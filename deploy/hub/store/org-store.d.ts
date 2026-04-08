import type { Organization } from '../models/tenant';
export declare class OrgStore {
    /**
     * Load all organizations keyed by id.
     * 按 id 加载全部组织记录。
     */
    private load;
    /**
     * Persist organization store.
     * 持久化组织存储。
     */
    private save;
    /**
     * Create a new organization.
     * 创建新组织。
     */
    create(tenantId: string, name: string, slug: string): Organization;
    /**
     * Get organization by id.
     * 按 id 获取组织。
     */
    get(id: string): Organization | null;
    /**
     * List organizations under one tenant.
     * 列出某个租户下的所有组织。
     */
    listByTenant(tenantId: string): Organization[];
    /**
     * Update organization fields.
     * 更新组织字段。
     */
    update(id: string, updates: Partial<Pick<Organization, 'name' | 'slug'>>): Organization | null;
    /**
     * Delete organization by id.
     * 按 id 删除组织。
     */
    delete(id: string): boolean;
}
export declare const orgStore: OrgStore;
//# sourceMappingURL=org-store.d.ts.map