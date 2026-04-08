"use strict";
// Hub routes - Organization API
// POST   /api/org        → 创建 organization / Create organization
// GET    /api/org        → 列出当前 tenant 下的 organizations / List organizations in current tenant
// GET    /api/org/:id    → 获取单个 organization / Get one organization
// PATCH  /api/org/:id    → 更新 organization / Update organization
// DELETE /api/org/:id    → 删除 organization / Delete organization
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const org_store_1 = require("../store/org-store");
const server_1 = require("../server");
const router = (0, express_1.Router)();
/**
 * Resolve tenantId from request context first, then request body.
 * 优先从请求上下文读取 tenantId，其次回退到 body。
 */
function resolveTenantId(req) {
    const fromContext = req.tenantContext?.tenantId?.trim();
    if (fromContext)
        return fromContext;
    const fromBody = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
    return fromBody || undefined;
}
/**
 * Ensure organization belongs to current tenant.
 * 确保 organization 属于当前 tenant，避免越权访问。
 */
function ensureTenantAccess(req, orgTenantId) {
    const tenantId = req.tenantContext?.tenantId?.trim();
    if (!tenantId)
        return true;
    return tenantId === orgTenantId;
}
/**
 * POST /
 * Create organization.
 * 创建 organization。
 *
 * Body: { tenantId?, name, slug }
 */
router.post('/', (0, server_1.asyncHandler)(async (req, res) => {
    const tenantId = resolveTenantId(req);
    const { name, slug } = req.body;
    if (!tenantId) {
        res.status(400).json({ error: 'tenantId is required' });
        return;
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: 'name is required' });
        return;
    }
    if (!slug || typeof slug !== 'string' || !slug.trim()) {
        res.status(400).json({ error: 'slug is required' });
        return;
    }
    const org = org_store_1.orgStore.create(tenantId, name, slug);
    res.status(201).json({ success: true, org });
}));
/**
 * GET /
 * List organizations for current tenant.
 * 列出当前 tenant 下的 organizations。
 */
router.get('/', (0, server_1.asyncHandler)(async (req, res) => {
    const tenantId = req.tenantContext?.tenantId?.trim();
    if (!tenantId) {
        res.status(400).json({ error: 'tenantId is required' });
        return;
    }
    const organizations = org_store_1.orgStore.listByTenant(tenantId);
    res.json({ success: true, total: organizations.length, organizations });
}));
/**
 * GET /:id
 * Get one organization by id.
 * 按 id 获取单个 organization。
 */
router.get('/:id', (0, server_1.asyncHandler)(async (req, res) => {
    const org = org_store_1.orgStore.get(req.params.id);
    if (!org) {
        res.status(404).json({ error: 'Organization not found' });
        return;
    }
    if (!ensureTenantAccess(req, org.tenantId)) {
        res.status(403).json({ error: 'Organization access denied' });
        return;
    }
    res.json({ success: true, org });
}));
/**
 * PATCH /:id
 * Update organization fields.
 * 更新 organization 字段。
 *
 * Body: { name?, slug? }
 */
router.patch('/:id', (0, server_1.asyncHandler)(async (req, res) => {
    const existing = org_store_1.orgStore.get(req.params.id);
    if (!existing) {
        res.status(404).json({ error: 'Organization not found' });
        return;
    }
    if (!ensureTenantAccess(req, existing.tenantId)) {
        res.status(403).json({ error: 'Organization access denied' });
        return;
    }
    const { name, slug } = req.body;
    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
        res.status(400).json({ error: 'name must be a non-empty string' });
        return;
    }
    if (slug !== undefined && (typeof slug !== 'string' || !slug.trim())) {
        res.status(400).json({ error: 'slug must be a non-empty string' });
        return;
    }
    const org = org_store_1.orgStore.update(req.params.id, { name, slug });
    res.json({ success: true, org });
}));
/**
 * DELETE /:id
 * Delete organization.
 * 删除 organization。
 */
router.delete('/:id', (0, server_1.asyncHandler)(async (req, res) => {
    const existing = org_store_1.orgStore.get(req.params.id);
    if (!existing) {
        res.status(404).json({ error: 'Organization not found' });
        return;
    }
    if (!ensureTenantAccess(req, existing.tenantId)) {
        res.status(403).json({ error: 'Organization access denied' });
        return;
    }
    const deleted = org_store_1.orgStore.delete(req.params.id);
    if (!deleted) {
        res.status(404).json({ error: 'Organization not found' });
        return;
    }
    res.json({ success: true });
}));
exports.default = router;
//# sourceMappingURL=org.js.map