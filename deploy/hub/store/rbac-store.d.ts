import type { Role, RoleAssignment } from '../models/rbac';
export declare class RbacStore {
    private load;
    private save;
    /**
     * Create a custom role for a tenant / 为租户创建自定义角色
     */
    createRole(tenantId: string, name: string, displayName: string, permissions: string[]): Role;
    /**
     * Get role by id / 按角色 ID 获取角色
     */
    getRole(id: string): Role | null;
    /**
     * List all roles under a tenant / 列出租户下全部角色
     */
    listRoles(tenantId: string): Role[];
    /**
     * Assign a role to a user / 给用户授予角色
     */
    assignRole(userId: string, roleId: string, tenantId: string, orgId?: string, grantedBy?: string): RoleAssignment;
    /**
     * Get all roles assigned to a user in a tenant / 获取用户在某租户下的全部角色
     */
    getUserRoles(userId: string, tenantId: string): Role[];
    /**
     * Check whether user has permission / 检查用户是否拥有指定权限
     * Permissions are stored as strings like "memory:read:org" or "*"
     */
    checkPermission(userId: string, tenantId: string, resource: string, action: string): boolean;
    /**
     * Initialize built-in default roles for a tenant.
     * 为租户初始化内置默认角色：owner/admin/manager/agent/guest/auditor
     */
    initDefaultRoles(tenantId: string): Role[];
}
export declare const rbacStore: RbacStore;
//# sourceMappingURL=rbac-store.d.ts.map