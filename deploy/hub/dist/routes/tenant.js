"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const tenant_store_1 = require("../store/tenant-store");
const server_1 = require("../server");
const router = (0, express_1.Router)();
/**
 * Read auth payload from request.
 * 从请求中读取认证后的 JWT payload。
 */
function getJwtPayload(req) {
    return req.jwtPayload ?? {};
}
/**
 * Admin permission guard.
 * 管理员权限校验。
 *
 * Note:
 * - Accept both `admin` and `ceo` as elevated roles.
 * - 同时接受 `admin` 与 `ceo` 作为高权限角色。
 */
function requireAdmin(req, res) {
    const { role } = getJwtPayload(req);
    if (role !== 'admin' && role !== 'ceo') {
        res.status(403).json({ error: 'Admin access required', code: 'FORBIDDEN' });
        return false;
    }
    return true;
}
/**
 * Validate tenant plan.
 * 校验租户套餐字段。
 */
function isValidPlan(plan) {
    return plan === 'free' || plan === 'pro' || plan === 'enterprise';
}
/**
 * Validate tenant status.
 * 校验租户状态字段。
 */
function isValidStatus(status) {
    return status === 'active' || status === 'suspended' || status === 'deleted';
}
/**
 * POST /
 * Create tenant (admin only).
 * 创建 tenant（仅管理员）。
 */
router.post('/', (0, server_1.asyncHandler)(async (req, res) => {
    if (!requireAdmin(req, res))
        return;
    const { name, slug, plan = 'free' } = (req.body ?? {});
    if (!name || typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: 'name is required', code: 'VALIDATION_ERROR' });
        return;
    }
    if (!slug || typeof slug !== 'string' || !slug.trim()) {
        res.status(400).json({ error: 'slug is required', code: 'VALIDATION_ERROR' });
        return;
    }
    if (!isValidPlan(plan)) {
        res.status(400).json({ error: 'Invalid plan. Must be free | pro | enterprise', code: 'VALIDATION_ERROR' });
        return;
    }
    const existing = tenant_store_1.tenantStore.list().find((tenant) => tenant.slug === slug.trim().toLowerCase());
    if (existing && existing.status !== 'deleted') {
        res.status(409).json({ error: 'Tenant slug already exists', code: 'CONFLICT' });
        return;
    }
    const tenant = tenant_store_1.tenantStore.create(name, slug, plan);
    res.status(201).json({ success: true, tenant });
}));
/**
 * GET /
 * List tenants.
 * 获取 tenant 列表。
 */
router.get('/', (0, server_1.asyncHandler)(async (req, res) => {
    const includeDeleted = String(req.query.includeDeleted ?? 'false') === 'true';
    const tenants = tenant_store_1.tenantStore
        .list()
        .filter((tenant) => includeDeleted || tenant.status !== 'deleted');
    res.json({ success: true, total: tenants.length, tenants });
}));
/**
 * GET /:id
 * Get single tenant.
 * 获取单个 tenant。
 */
router.get('/:id', (0, server_1.asyncHandler)(async (req, res) => {
    const includeDeleted = String(req.query.includeDeleted ?? 'false') === 'true';
    const tenant = tenant_store_1.tenantStore.get(req.params.id);
    if (!tenant || (!includeDeleted && tenant.status === 'deleted')) {
        res.status(404).json({ error: 'Tenant not found', code: 'NOT_FOUND' });
        return;
    }
    res.json({ success: true, tenant });
}));
/**
 * PATCH /:id
 * Update tenant.
 * 更新 tenant。
 */
router.patch('/:id', (0, server_1.asyncHandler)(async (req, res) => {
    const tenant = tenant_store_1.tenantStore.get(req.params.id);
    if (!tenant || tenant.status === 'deleted') {
        res.status(404).json({ error: 'Tenant not found', code: 'NOT_FOUND' });
        return;
    }
    const { name, slug, plan, status, settings } = (req.body ?? {});
    if (plan !== undefined && !isValidPlan(plan)) {
        res.status(400).json({ error: 'Invalid plan. Must be free | pro | enterprise', code: 'VALIDATION_ERROR' });
        return;
    }
    if (status !== undefined && !isValidStatus(status)) {
        res.status(400).json({ error: 'Invalid status. Must be active | suspended | deleted', code: 'VALIDATION_ERROR' });
        return;
    }
    if (slug !== undefined) {
        const normalizedSlug = slug.trim().toLowerCase();
        if (!normalizedSlug) {
            res.status(400).json({ error: 'slug cannot be empty', code: 'VALIDATION_ERROR' });
            return;
        }
        const duplicate = tenant_store_1.tenantStore.list().find((item) => (item.id !== req.params.id
            && item.slug === normalizedSlug
            && item.status !== 'deleted'));
        if (duplicate) {
            res.status(409).json({ error: 'Tenant slug already exists', code: 'CONFLICT' });
            return;
        }
    }
    const updated = tenant_store_1.tenantStore.update(req.params.id, {
        ...(name !== undefined ? { name } : {}),
        ...(slug !== undefined ? { slug } : {}),
        ...(plan !== undefined ? { plan } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(settings !== undefined ? { settings } : {}),
    });
    if (!updated) {
        res.status(404).json({ error: 'Tenant not found', code: 'NOT_FOUND' });
        return;
    }
    res.json({ success: true, tenant: updated });
}));
/**
 * DELETE /:id
 * Soft delete tenant by marking status=deleted.
 * 软删除 tenant：将状态标记为 deleted。
 */
router.delete('/:id', (0, server_1.asyncHandler)(async (req, res) => {
    const tenant = tenant_store_1.tenantStore.get(req.params.id);
    if (!tenant || tenant.status === 'deleted') {
        res.status(404).json({ error: 'Tenant not found', code: 'NOT_FOUND' });
        return;
    }
    const deleted = tenant_store_1.tenantStore.update(req.params.id, { status: 'deleted' });
    res.json({ success: true, tenant: deleted });
}));
exports.default = router;
//# sourceMappingURL=tenant.js.map