"use strict";
/**
 * RBAC Roles Routes / RBAC 角色路由
 *
 * POST   /api/roles          — 创建自定义角色 / Create a custom role
 * GET    /api/roles          — 列出租户下所有角色 / List all roles in tenant
 * GET    /api/roles/:id      — 获取单个角色 / Get a single role
 * PATCH  /api/roles/:id      — 更新角色权限 / Update role permissions
 * DELETE /api/roles/:id      — 删除自定义角色 / Delete custom role only
 * POST   /api/roles/assign   — 给用户分配角色 / Assign role to user
 * GET    /api/roles/user/:userId — 获取用户全部角色 / Get all roles for a user
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const server_1 = require("../server");
const rbac_store_1 = require("../store/rbac-store");
const router = (0, express_1.Router)();
/**
 * Get tenantId from request context.
 * 从请求上下文中获取 tenantId。
 */
function requireTenantId(req) {
    const tenantId = req.tenantContext?.tenantId ?? req.headers['x-tenant-id'];
    if (!tenantId || !String(tenantId).trim()) {
        throw Object.assign(new Error('tenantId is required / 缺少 tenantId'), { status: 400 });
    }
    return String(tenantId).trim();
}
/**
 * Get current operator/user id.
 * 获取当前操作者 ID。
 */
function getOperatorId(req) {
    return String(req.tenantContext?.userId
        ?? req.jwtPayload?.nodeId
        ?? req.jwtPayload?.role
        ?? 'system');
}
/**
 * Normalize permission list.
 * 规范化权限列表，兼容字符串或对象 { resource, action, scope } 输入。
 * 最终返回 string[]，格式 "resource:action:scope"
 */
function normalizePermissions(input) {
    if (!Array.isArray(input)) {
        throw Object.assign(new Error('permissions must be an array / permissions 必须是数组'), { status: 400 });
    }
    return input.map((item, index) => {
        // Accept string like "memory:read:org"
        if (typeof item === 'string') {
            const trimmed = item.trim();
            if (!trimmed)
                throw Object.assign(new Error(`empty permission at index ${index}`), { status: 400 });
            return trimmed;
        }
        // Accept object { resource, action, scope? }
        if (item && typeof item === 'object') {
            const obj = item;
            const resource = typeof obj.resource === 'string' ? obj.resource.trim() : '';
            const action = typeof obj.action === 'string' ? obj.action.trim() : '';
            const scope = typeof obj.scope === 'string' ? obj.scope.trim() : 'tenant';
            if (!resource || !action) {
                throw Object.assign(new Error(`permission.resource and permission.action are required at index ${index}`), { status: 400 });
            }
            return `${resource}:${action}:${scope}`;
        }
        throw Object.assign(new Error(`invalid permission at index ${index}`), { status: 400 });
    });
}
/**
 * Read full RBAC data through store internals.
 * 通过 store 内部方法读取完整 RBAC 数据。
 */
function loadRbacData() {
    return rbac_store_1.rbacStore.load();
}
/**
 * Persist full RBAC data through store internals.
 * 通过 store 内部方法保存完整 RBAC 数据。
 */
function saveRbacData(data) {
    ;
    rbac_store_1.rbacStore.save(data);
}
// POST /api/roles
router.post('/', (0, server_1.asyncHandler)(async (req, res) => {
    const tenantId = requireTenantId(req);
    const { name, displayName, permissions } = req.body;
    if (!name || typeof name !== 'string') {
        res.status(400).json({ error: 'name is required / name 必填' });
        return;
    }
    const role = rbac_store_1.rbacStore.createRole(tenantId, name, typeof displayName === 'string' ? displayName : name, normalizePermissions(permissions ?? []));
    res.status(201).json({ role });
}));
// GET /api/roles
router.get('/', (0, server_1.asyncHandler)(async (req, res) => {
    const tenantId = requireTenantId(req);
    // Ensure built-in roles exist before listing.
    // 列表前自动补齐系统默认角色。
    rbac_store_1.rbacStore.initDefaultRoles(tenantId);
    const roles = rbac_store_1.rbacStore.listRoles(tenantId);
    res.json({ roles, count: roles.length });
}));
// GET /api/roles/user/:userId
router.get('/user/:userId', (0, server_1.asyncHandler)(async (req, res) => {
    const tenantId = requireTenantId(req);
    const { userId } = req.params;
    const roles = rbac_store_1.rbacStore.getUserRoles(userId, tenantId);
    res.json({ userId, tenantId, roles, count: roles.length });
}));
// POST /api/roles/assign
router.post('/assign', (0, server_1.asyncHandler)(async (req, res) => {
    const tenantId = requireTenantId(req);
    const { userId, roleId, orgId } = req.body;
    if (!userId || !roleId) {
        res.status(400).json({ error: 'userId and roleId are required / userId 和 roleId 必填' });
        return;
    }
    const assignment = rbac_store_1.rbacStore.assignRole(userId, roleId, tenantId, orgId, getOperatorId(req));
    res.status(201).json({ assignment });
}));
// GET /api/roles/:id
router.get('/:id', (0, server_1.asyncHandler)(async (req, res) => {
    const tenantId = requireTenantId(req);
    const role = rbac_store_1.rbacStore.getRole(req.params.id);
    if (!role || role.tenantId !== tenantId) {
        res.status(404).json({ error: 'role not found / 角色不存在' });
        return;
    }
    res.json({ role });
}));
// PATCH /api/roles/:id
router.patch('/:id', (0, server_1.asyncHandler)(async (req, res) => {
    const tenantId = requireTenantId(req);
    const { permissions, displayName } = req.body;
    const data = loadRbacData();
    const roleIndex = data.roles.findIndex(role => role.id === req.params.id && role.tenantId === tenantId);
    if (roleIndex === -1) {
        res.status(404).json({ error: 'role not found / 角色不存在' });
        return;
    }
    const currentRole = data.roles[roleIndex];
    const nextPermissions = permissions === undefined
        ? currentRole.permissions
        : normalizePermissions(permissions);
    const updatedRole = {
        ...currentRole,
        displayName: typeof displayName === 'string' && displayName.trim() ? displayName.trim() : currentRole.displayName,
        permissions: nextPermissions,
        updatedAt: Date.now(),
    };
    data.roles[roleIndex] = updatedRole;
    saveRbacData(data);
    res.json({ role: updatedRole });
}));
// DELETE /api/roles/:id
router.delete('/:id', (0, server_1.asyncHandler)(async (req, res) => {
    const tenantId = requireTenantId(req);
    const data = loadRbacData();
    const role = data.roles.find(item => item.id === req.params.id && item.tenantId === tenantId);
    if (!role) {
        res.status(404).json({ error: 'role not found / 角色不存在' });
        return;
    }
    // System roles cannot be deleted.
    // 系统角色不可删除。
    if (role.isSystem) {
        res.status(403).json({ error: 'system role cannot be deleted / 系统角色不能删除' });
        return;
    }
    data.roles = data.roles.filter(item => item.id !== role.id);
    data.assignments = data.assignments.filter(item => item.roleId !== role.id);
    saveRbacData(data);
    res.json({ success: true, deletedRoleId: role.id });
}));
exports.default = router;
//# sourceMappingURL=roles.js.map