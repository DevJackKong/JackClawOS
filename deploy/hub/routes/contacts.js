"use strict";
/**
 * Contacts Routes / 联系人路由
 *
 * POST   /api/contacts               — Create contact / 创建联系人
 * GET    /api/contacts               — List contacts / 列出联系人
 * GET    /api/contacts/:id           — Get one contact / 获取单个联系人
 * PATCH  /api/contacts/:id           — Update contact / 更新联系人
 * DELETE /api/contacts/:id           — Delete contact / 删除联系人
 * POST   /api/contacts/:id/channels  — Add one contact channel / 添加联系渠道
 * POST   /api/contacts/:id/tags      — Add one tag / 添加标签
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const server_1 = require("../server");
const contact_store_1 = require("../store/contact-store");
const router = (0, express_1.Router)();
const CONTACT_TYPES = ['customer', 'lead', 'partner', 'internal', 'bot'];
const CHANNEL_TYPES = ['wechat', 'feishu', 'whatsapp', 'email', 'phone', 'telegram', 'other'];
/**
 * Resolve tenantId from tenant context first, then query/body.
 * 优先从 tenant context 获取 tenantId，其次回退到 query/body。
 */
function resolveTenantId(req) {
    const fromContext = req.tenantContext?.tenantId?.trim();
    if (fromContext)
        return fromContext;
    const fromQuery = typeof req.query.tenantId === 'string' ? req.query.tenantId.trim() : '';
    if (fromQuery)
        return fromQuery;
    const fromBody = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
    return fromBody || undefined;
}
/**
 * Validate contact type.
 * 校验联系人类型。
 */
function isValidContactType(type) {
    return typeof type === 'string' && CONTACT_TYPES.includes(type);
}
/**
 * Validate channel type.
 * 校验联系渠道类型。
 */
function isValidChannelType(type) {
    return typeof type === 'string' && CHANNEL_TYPES.includes(type);
}
/**
 * Parse positive integer limit.
 * 解析正整数 limit。
 */
function parseLimit(value) {
    if (value === undefined || value === null || value === '')
        return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return undefined;
    return Math.floor(parsed);
}
/**
 * Map store thrown errors to HTTP response.
 * 将 store 抛出的错误映射为 HTTP 响应。
 */
function handleStoreError(error, res) {
    const status = typeof error?.status === 'number'
        ? Number(error.status)
        : 500;
    const message = error instanceof Error ? error.message : 'internal_server_error';
    res.status(status).json({ error: message });
}
/**
 * POST /
 * Create one contact.
 * 创建联系人。
 */
router.post('/', (0, server_1.asyncHandler)(async (req, res) => {
    const tenantId = resolveTenantId(req);
    const { name, type, orgId, nodeId, displayName, channels, tags, metadata } = req.body;
    if (!tenantId) {
        res.status(400).json({ error: 'tenantId is required / 缺少 tenantId' });
        return;
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: 'name is required / name 必填' });
        return;
    }
    if (!isValidContactType(type)) {
        res.status(400).json({ error: 'invalid type / 非法联系人类型' });
        return;
    }
    const contact = contact_store_1.contactStore.create(tenantId, name, type, {
        orgId,
        nodeId,
        displayName,
        channels,
        tags,
        metadata,
    });
    res.status(201).json({ success: true, contact });
}));
/**
 * GET /
 * List contacts with optional filters.
 * 按条件列出联系人。
 *
 * Query:
 * - tenantId: string
 * - type: Contact type
 * - tag: string
 * - search: string
 * - limit: number
 */
router.get('/', (0, server_1.asyncHandler)(async (req, res) => {
    const tenantId = resolveTenantId(req);
    const type = typeof req.query.type === 'string' ? req.query.type.trim() : undefined;
    const tag = typeof req.query.tag === 'string' ? req.query.tag.trim() : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : undefined;
    const limit = parseLimit(req.query.limit);
    if (!tenantId) {
        res.status(400).json({ error: 'tenantId is required / 缺少 tenantId' });
        return;
    }
    if (type && !isValidContactType(type)) {
        res.status(400).json({ error: 'invalid type / 非法联系人类型' });
        return;
    }
    if (req.query.limit !== undefined && limit === undefined) {
        res.status(400).json({ error: 'limit must be a positive integer / limit 必须为正整数' });
        return;
    }
    const contacts = contact_store_1.contactStore.list(tenantId, { type, tag, search, limit });
    res.json({ success: true, total: contacts.length, contacts });
}));
/**
 * GET /:id
 * Get one contact by id.
 * 按 id 获取联系人。
 */
router.get('/:id', (0, server_1.asyncHandler)(async (req, res) => {
    const contact = contact_store_1.contactStore.get(req.params.id);
    if (!contact) {
        res.status(404).json({ error: 'contact_not_found / 联系人不存在' });
        return;
    }
    res.json({ success: true, contact });
}));
/**
 * PATCH /:id
 * Update mutable contact fields.
 * 更新联系人可变字段。
 */
router.patch('/:id', (0, server_1.asyncHandler)(async (req, res) => {
    const { name, displayName, type, channels, tags, metadata } = req.body;
    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
        res.status(400).json({ error: 'name must be a non-empty string / name 不能为空' });
        return;
    }
    if (type !== undefined && !isValidContactType(type)) {
        res.status(400).json({ error: 'invalid type / 非法联系人类型' });
        return;
    }
    try {
        const contact = contact_store_1.contactStore.update(req.params.id, {
            ...(name !== undefined ? { name } : {}),
            ...(displayName !== undefined ? { displayName } : {}),
            ...(type !== undefined ? { type } : {}),
            ...(channels !== undefined ? { channels } : {}),
            ...(tags !== undefined ? { tags } : {}),
            ...(metadata !== undefined ? { metadata } : {}),
        });
        res.json({ success: true, contact });
    }
    catch (error) {
        handleStoreError(error, res);
    }
}));
/**
 * DELETE /:id
 * Delete one contact.
 * 删除联系人。
 */
router.delete('/:id', (0, server_1.asyncHandler)(async (req, res) => {
    const removed = contact_store_1.contactStore.delete(req.params.id);
    if (!removed) {
        res.status(404).json({ error: 'contact_not_found / 联系人不存在' });
        return;
    }
    res.json({ success: true, id: req.params.id });
}));
/**
 * POST /:id/channels
 * Add one channel to a contact.
 * 为联系人添加联系渠道。
 *
 * Body:
 * - type: wechat | feishu | whatsapp | email | phone | telegram | other
 * - identifier: string
 * - isPrimary?: boolean
 */
router.post('/:id/channels', (0, server_1.asyncHandler)(async (req, res) => {
    const { type, identifier, isPrimary } = req.body;
    if (!isValidChannelType(type)) {
        res.status(400).json({ error: 'invalid channel type / 非法渠道类型' });
        return;
    }
    if (!identifier || typeof identifier !== 'string' || !identifier.trim()) {
        res.status(400).json({ error: 'identifier is required / identifier 必填' });
        return;
    }
    try {
        const contact = contact_store_1.contactStore.addChannel(req.params.id, {
            type,
            identifier,
            ...(isPrimary === true ? { isPrimary: true } : {}),
        });
        res.status(201).json({ success: true, contact });
    }
    catch (error) {
        handleStoreError(error, res);
    }
}));
/**
 * POST /:id/tags
 * Add one tag to a contact.
 * 为联系人添加标签。
 *
 * Body:
 * - tag: string
 */
router.post('/:id/tags', (0, server_1.asyncHandler)(async (req, res) => {
    const { tag } = req.body;
    if (!tag || typeof tag !== 'string' || !tag.trim()) {
        res.status(400).json({ error: 'tag is required / tag 必填' });
        return;
    }
    try {
        const contact = contact_store_1.contactStore.addTag(req.params.id, tag);
        res.status(201).json({ success: true, contact });
    }
    catch (error) {
        handleStoreError(error, res);
    }
}));
exports.default = router;
//# sourceMappingURL=contacts.js.map