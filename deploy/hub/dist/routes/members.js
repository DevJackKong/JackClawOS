"use strict";
/**
 * /api/members — Organization members routes / 组织成员路由
 *
 * POST   /        — Add a member to an org / 添加成员到组织
 * GET    /        — List org members / 列出组织成员
 * PATCH  /:id     — Update member role / 更新成员角色
 * DELETE /:id     — Remove member / 移除成员
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const member_store_1 = require("../store/member-store");
const server_1 = require("../server");
const router = (0, express_1.Router)();
/**
 * POST /
 * Add a member to an organization.
 * 添加成员到指定组织。
 *
 * Body:
 * - tenantId: string
 * - orgId: string
 * - userId: string
 * - role: string
 */
router.post('/', (0, server_1.asyncHandler)(async (req, res) => {
    const { tenantId, orgId, userId, role } = req.body;
    if (!tenantId || !orgId || !userId || !role) {
        res.status(400).json({ error: 'tenantId, orgId, userId, role required' });
        return;
    }
    const existingMember = member_store_1.memberStore.getByUser(userId, tenantId);
    if (existingMember && existingMember.orgId === orgId) {
        res.status(409).json({ error: 'member_already_exists', member: existingMember });
        return;
    }
    const member = member_store_1.memberStore.add(tenantId, orgId, userId, role);
    res.status(201).json({ status: 'ok', member });
}));
/**
 * GET /
 * List all members in one organization.
 * 列出某个组织下的全部成员。
 *
 * Query:
 * - orgId: string
 */
router.get('/', (0, server_1.asyncHandler)(async (req, res) => {
    const orgId = typeof req.query.orgId === 'string' ? req.query.orgId : undefined;
    if (!orgId) {
        res.status(400).json({ error: 'orgId required' });
        return;
    }
    const members = member_store_1.memberStore.listByOrg(orgId);
    res.json({ status: 'ok', members, count: members.length });
}));
/**
 * PATCH /:id
 * Update member role by member id.
 * 按成员 id 更新角色。
 *
 * Body:
 * - role: string
 */
router.patch('/:id', (0, server_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;
    if (!role) {
        res.status(400).json({ error: 'role required' });
        return;
    }
    const member = member_store_1.memberStore.updateRole(id, role);
    if (!member) {
        res.status(404).json({ error: 'member_not_found' });
        return;
    }
    res.json({ status: 'ok', member });
}));
/**
 * DELETE /:id
 * Remove a member by member id.
 * 按成员 id 移除成员。
 */
router.delete('/:id', (0, server_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const removed = member_store_1.memberStore.remove(id);
    if (!removed) {
        res.status(404).json({ error: 'member_not_found' });
        return;
    }
    res.json({ status: 'ok', id });
}));
exports.default = router;
//# sourceMappingURL=members.js.map