"use strict";
/**
 * JackClaw Hub - Presence API Routes
 *
 * GET /api/presence/:handle  — query online state for a @handle
 * GET /api/presence/online   — list all currently online @handles
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const presence_1 = require("../presence");
const directory_1 = require("../store/directory");
const router = (0, express_1.Router)();
// GET /api/presence/online — list all online users with enriched info
// NOTE: this route must be registered BEFORE /:handle to avoid shadowing
router.get('/online', (_req, res) => {
    const handles = presence_1.presenceManager.getOnlineHandles();
    const users = handles.map(handle => {
        const resolved = presence_1.presenceManager.resolveHandle(handle);
        const profile = directory_1.directoryStore.getProfile(handle);
        return {
            handle,
            nodeId: resolved.nodeId ?? '',
            displayName: profile?.displayName ?? handle,
            role: profile?.role ?? 'member',
            onlineSince: resolved.nodeId ? (presence_1.presenceManager.getConnectedAt(resolved.nodeId) ?? null) : null,
        };
    });
    return res.json({ users, count: users.length });
});
// GET /api/presence/:handle — presence info for a specific @handle
router.get('/:handle', (req, res) => {
    const handle = decodeURIComponent(req.params.handle);
    const resolved = presence_1.presenceManager.resolveHandle(handle);
    const presence = presence_1.presenceManager.getPresence(handle);
    return res.json({
        handle,
        nodeId: resolved.nodeId,
        online: resolved.online,
        wsConnected: resolved.wsConnected,
        lastSeen: presence.lastSeen,
        connectedChannels: presence.connectedChannels,
    });
});
exports.default = router;
//# sourceMappingURL=presence.js.map