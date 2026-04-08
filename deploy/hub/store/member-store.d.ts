import type { Member } from '../models/tenant';
export declare class MemberStore {
    /**
     * Load all members from disk.
     * 从磁盘加载全部成员。
     */
    private load;
    /**
     * Persist all members to disk.
     * 将全部成员持久化到磁盘。
     */
    private save;
    /**
     * Add a new member record.
     * 添加成员记录。
     */
    add(tenantId: string, orgId: string, userId: string, role: string): Member;
    /**
     * Get one member by id.
     * 按 id 获取成员。
     */
    get(id: string): Member | null;
    /**
     * Find member by user within one tenant.
     * 在指定租户内按 userId 查成员。
     */
    getByUser(userId: string, tenantId: string): Member | null;
    /**
     * List all members under one organization.
     * 列出某个组织下的全部成员。
     */
    listByOrg(orgId: string): Member[];
    /**
     * List all members under one tenant.
     * 列出某个租户下的全部成员。
     */
    listByTenant(tenantId: string): Member[];
    /**
     * Update member role.
     * 更新成员角色。
     */
    updateRole(id: string, role: string): Member | null;
    /**
     * Remove member by id.
     * 按 id 删除成员。
     */
    remove(id: string): boolean;
}
export declare const memberStore: MemberStore;
//# sourceMappingURL=member-store.d.ts.map