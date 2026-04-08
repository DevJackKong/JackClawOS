"use strict";
/**
 * Search Routes
 *
 * GET /api/search/messages?q=&from=&to=&after=&before=&limit=&offset=
 * GET /api/search/contacts?q=
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const message_store_1 = require("../store/message-store");
const presence_1 = require("../presence");
const directory_1 = require("../store/directory");
const rbac_helpers_1 = require("./rbac-helpers");
const router = (0, express_1.Router)();
const HUB_DIR = path_1.default.join(os_1.default.homedir(), '.jackclaw', 'hub');
// ─── GET /messages ────────────────────────────────────────────────────────────
router.get('/messages', (req, res) => {
    const requester = (0, rbac_helpers_1.getRequester)(req);
    if (!requester)
        return res.status(401).json({ error: 'Unauthorized' });
    const { q, from, to, after, before, limit: limitStr, offset: offsetStr, } = req.query;
    if (!q?.trim()) {
        return res.status(400).json({ error: 'q (query) required' });
    }
    // SECURITY: non-admin can only search messages where they are sender or recipient
    const scopedFrom = (0, rbac_helpers_1.isAdmin)(req) ? (from || undefined) : requester;
    const scopedTo = (0, rbac_helpers_1.isAdmin)(req) ? (to || undefined) : requester;
    const results = message_store_1.messageStore.searchMessages(q, {
        from: scopedFrom,
        to: scopedTo,
        after: after ? parseInt(after, 10) : undefined,
        before: before ? parseInt(before, 10) : undefined,
        limit: limitStr ? Math.min(parseInt(limitStr, 10), 100) : 20,
        offset: offsetStr ? parseInt(offsetStr, 10) : 0,
    });
    // For non-admin, filter results to only messages involving the requester
    const filtered = (0, rbac_helpers_1.isAdmin)(req) ? results : results.filter((m) => m.from === requester || m.to === requester);
    return res.json({ results: filtered, count: filtered.length });
});
// ─── GET /contacts ────────────────────────────────────────────────────────────
router.get('/contacts', (req, res) => {
    const { q } = req.query;
    if (!q?.trim()) {
        return res.status(400).json({ error: 'q (query) required' });
    }
    const qLow = q.toLowerCase();
    // Load directory + profiles
    let dir = {};
    let profiles = {};
    try {
        dir = JSON.parse(fs_1.default.readFileSync(path_1.default.join(HUB_DIR, 'directory.json'), 'utf-8'));
    }
    catch { /* ok */ }
    try {
        profiles = JSON.parse(fs_1.default.readFileSync(path_1.default.join(HUB_DIR, 'social-profiles.json'), 'utf-8'));
    }
    catch { /* ok */ }
    const seen = new Set();
    const contacts = [];
    // Match by handle
    for (const [handle, info] of Object.entries(dir)) {
        if (handle.toLowerCase().includes(qLow)) {
            seen.add(handle);
            const profile = profiles[handle] ?? null;
            contacts.push({
                handle,
                nodeId: info.nodeId,
                displayName: profile?.ownerName ?? handle,
                role: directory_1.directoryStore.getProfile(handle)?.role ?? 'member',
                online: presence_1.presenceManager.getPresence(handle).online,
            });
        }
    }
    // Match by ownerName / bio in profiles for handles not already listed
    for (const [handle, p] of Object.entries(profiles)) {
        if (seen.has(handle))
            continue;
        if (p.ownerName?.toLowerCase().includes(qLow) ||
            p.bio?.toLowerCase().includes(qLow)) {
            contacts.push({
                handle,
                nodeId: dir[handle]?.nodeId ?? '',
                displayName: p.ownerName ?? handle,
                role: directory_1.directoryStore.getProfile(handle)?.role ?? 'member',
                online: presence_1.presenceManager.getPresence(handle).online,
            });
        }
    }
    return res.json({ contacts, count: contacts.length });
});
exports.default = router;
//# sourceMappingURL=search.js.map