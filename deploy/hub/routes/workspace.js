"use strict";
// Hub routes — Workspace API
// POST   /api/workspace        — 创建 workspace / Create workspace
// GET    /api/workspace        — 列出当前 org 下的 workspaces / List workspaces in current org
// GET    /api/workspace/:id    — 获取单个 workspace / Get one workspace
// PATCH  /api/workspace/:id    — 更新 workspace / Update workspace
// DELETE /api/workspace/:id    — 删除 workspace / Delete workspace
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const workspace_store_1 = require("../store/workspace-store");
const server_1 = require("../server");
const router = (0, express_1.Router)();
/**
 * 从请求上下文解析当前组织与租户。
 * Resolve current org/tenant from request context.
 */
function getScope(req) {
    const orgId = req.tenantContext?.orgId
        ?? req.jwtPayload?.orgId
        ?? req.jwtPayload?.org_id;
    const tenantId = req.tenantContext?.tenantId
        ?? req.jwtPayload?.tenantId
        ?? req.jwtPayload?.tenant_id;
    return { orgId, tenantId };
}
/**
 * 校验 workspace 是否属于当前 org。
 * Ensure the workspace belongs to current org.
 */
function ensureWorkspaceInOrg(id, orgId) {
    const workspace = workspace_store_1.workspaceStore.get(id);
    if (!workspace)
        return { error: 'workspace_not_found' };
    if (workspace.orgId !== orgId)
        return { error: 'workspace_forbidden' };
    return { workspace };
}
/**
 * POST /
 * 创建 workspace。
 * Create a workspace under current org.
 */
router.post('/', (0, server_1.asyncHandler)(async (req, res) => {
    const { orgId, tenantId } = getScope(req);
    if (!orgId) {
        res.status(400).json({ error: 'orgId required in request context' });
        return;
    }
    if (!tenantId) {
        res.status(400).json({ error: 'tenantId required in request context' });
        return;
    }
    const { name, slug } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: 'name is required' });
        return;
    }
    if (!slug || typeof slug !== 'string' || !slug.trim()) {
        res.status(400).json({ error: 'slug is required' });
        return;
    }
    const workspace = workspace_store_1.workspaceStore.create(orgId, tenantId, name, slug);
    res.status(201).json({ workspace });
}));
/**
 * GET /
 * 列出当前 org 下的所有 workspace。
 * List all workspaces in current org.
 */
router.get('/', (0, server_1.asyncHandler)(async (req, res) => {
    const { orgId } = getScope(req);
    if (!orgId) {
        res.status(400).json({ error: 'orgId required in request context' });
        return;
    }
    const workspaces = workspace_store_1.workspaceStore.listByOrg(orgId);
    res.json({ workspaces, count: workspaces.length });
}));
/**
 * GET /:id
 * 获取当前 org 下的单个 workspace。
 * Get a single workspace in current org.
 */
router.get('/:id', (0, server_1.asyncHandler)(async (req, res) => {
    const { orgId } = getScope(req);
    if (!orgId) {
        res.status(400).json({ error: 'orgId required in request context' });
        return;
    }
    const result = ensureWorkspaceInOrg(req.params.id, orgId);
    if ('error' in result) {
        res.status(result.error === 'workspace_not_found' ? 404 : 403).json({ error: result.error });
        return;
    }
    res.json({ workspace: result.workspace });
}));
/**
 * PATCH /:id
 * 更新当前 org 下的 workspace。
 * Update a workspace in current org.
 */
router.patch('/:id', (0, server_1.asyncHandler)(async (req, res) => {
    const { orgId } = getScope(req);
    if (!orgId) {
        res.status(400).json({ error: 'orgId required in request context' });
        return;
    }
    const result = ensureWorkspaceInOrg(req.params.id, orgId);
    if ('error' in result) {
        res.status(result.error === 'workspace_not_found' ? 404 : 403).json({ error: result.error });
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
    const workspace = workspace_store_1.workspaceStore.update(req.params.id, { name, slug });
    res.json({ workspace });
}));
/**
 * DELETE /:id
 * 删除当前 org 下的 workspace。
 * Delete a workspace in current org.
 */
router.delete('/:id', (0, server_1.asyncHandler)(async (req, res) => {
    const { orgId } = getScope(req);
    if (!orgId) {
        res.status(400).json({ error: 'orgId required in request context' });
        return;
    }
    const result = ensureWorkspaceInOrg(req.params.id, orgId);
    if ('error' in result) {
        res.status(result.error === 'workspace_not_found' ? 404 : 403).json({ error: result.error });
        return;
    }
    workspace_store_1.workspaceStore.delete(req.params.id);
    res.json({ ok: true });
}));
exports.default = router;
//# sourceMappingURL=workspace.js.map