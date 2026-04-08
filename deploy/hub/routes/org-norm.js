"use strict";
// Hub routes — OrgNorm API
// GET    /api/org-norm          — 所有规范
// POST   /api/org-norm          — 新增规范
// PUT    /api/org-norm/:id      — 更新规范
// DELETE /api/org-norm/:id      — 删除规范
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const org_norm_1 = require("../store/org-norm");
const router = (0, express_1.Router)();
const store = (0, org_norm_1.getOrgNormStore)();
/**
 * GET /api/org-norm
 * Returns: { norms: OrgNorm[] }
 */
router.get('/', (_req, res) => {
    res.json({ norms: store.list() });
});
/**
 * POST /api/org-norm
 * Body: { title, content, category?, author? }
 * Returns: 201 { norm }
 */
router.post('/', (req, res) => {
    const { title, content, category, author } = req.body;
    if (!title || typeof title !== 'string' || title.trim() === '') {
        res.status(400).json({ error: 'title is required' });
        return;
    }
    if (!content || typeof content !== 'string' || content.trim() === '') {
        res.status(400).json({ error: 'content is required' });
        return;
    }
    const jwtPayload = req.jwtPayload;
    const resolvedAuthor = author || jwtPayload?.nodeId || 'unknown';
    const norm = store.add({
        title: title.trim(),
        content: content.trim(),
        category,
        author: resolvedAuthor,
    });
    res.status(201).json({ norm });
});
/**
 * PUT /api/org-norm/:id
 * Body: { title?, content?, category?, author? }
 * Returns: { norm }
 */
router.put('/:id', (req, res) => {
    const { title, content, category, author } = req.body;
    const norm = store.update(req.params.id, { title, content, category, author });
    if (!norm) {
        res.status(404).json({ error: 'Norm not found' });
        return;
    }
    res.json({ norm });
});
/**
 * DELETE /api/org-norm/:id
 */
router.delete('/:id', (req, res) => {
    const found = store.delete(req.params.id);
    if (!found) {
        res.status(404).json({ error: 'Norm not found' });
        return;
    }
    res.json({ ok: true });
});
exports.default = router;
//# sourceMappingURL=org-norm.js.map