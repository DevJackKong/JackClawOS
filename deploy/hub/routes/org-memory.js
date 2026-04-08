"use strict";
// Hub routes - OrgMemory API
// GET    /api/org-memory            → 所有记忆
// POST   /api/org-memory            → 新增记忆
// GET    /api/org-memory/search?q=  → 关键词搜索
// GET    /api/org-memory/:id        → 单条记忆
// DELETE /api/org-memory/:id        → 删除（CEO only）
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const org_memory_1 = require("../store/org-memory");
const store = new org_memory_1.OrgMemoryStore();
const router = (0, express_1.Router)();
/**
 * GET /api/org-memory
 * Query: ?type=decision&limit=10
 * Returns: { entries: OrgMemEntry[] }
 */
router.get('/', (req, res) => {
    const type = req.query.type || undefined;
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
    const entries = store.query(type, limit);
    res.json({ success: true, total: entries.length, entries });
});
/**
 * GET /api/org-memory/search?q=keyword
 * Returns: { entries: OrgMemEntry[] }
 */
router.get('/search', (req, res) => {
    const q = req.query.q || '';
    if (!q.trim()) {
        res.status(400).json({ error: 'q parameter is required' });
        return;
    }
    const entries = store.search(q.trim());
    res.json({ success: true, total: entries.length, entries });
});
/**
 * GET /api/org-memory/:id
 * Returns: { entry: OrgMemEntry }
 */
router.get('/:id', (req, res) => {
    const entry = store.get(req.params.id);
    if (!entry) {
        res.status(404).json({ error: 'Memory entry not found' });
        return;
    }
    res.json({ success: true, entry });
});
/**
 * POST /api/org-memory
 * Body: { type, content, nodeId, tags? }
 * Returns: 201 { entry }
 */
router.post('/', (req, res) => {
    const { type, content, nodeId, tags } = req.body;
    const validTypes = ['lesson', 'decision', 'feedback', 'milestone'];
    if (!type || !validTypes.includes(type)) {
        res.status(400).json({ error: `Missing or invalid type. Must be one of: ${validTypes.join(', ')}` });
        return;
    }
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
        res.status(400).json({ error: 'content is required' });
        return;
    }
    // Use nodeId from body, fallback to JWT payload
    const payload = req.jwtPayload;
    const resolvedNodeId = nodeId || payload?.nodeId || 'unknown';
    const entry = store.add({
        type,
        content: content.trim(),
        nodeId: resolvedNodeId,
        tags: Array.isArray(tags) ? tags : undefined,
    });
    res.status(201).json({ success: true, entry });
});
/**
 * DELETE /api/org-memory/:id
 * CEO only
 */
router.delete('/:id', (req, res) => {
    const payload = req.jwtPayload;
    if (!payload || payload.role !== 'ceo') {
        res.status(403).json({ error: 'Only CEO can delete org memories' });
        return;
    }
    const found = store.delete(req.params.id);
    if (!found) {
        res.status(404).json({ error: 'Memory entry not found' });
        return;
    }
    res.json({ success: true });
});
exports.default = router;
//# sourceMappingURL=org-memory.js.map