"use strict";
// JackClaw Hub — Federation Routes
// Inter-hub HTTP endpoints for the federation protocol
//
// POST /api/federation/handshake       — Hub-to-hub handshake
// POST /api/federation/message         — Receive a federated message
// GET  /api/federation/peers           — List known peer hubs
// POST /api/federation/discover        — Look up a remote @handle
// GET  /api/federation/status          — Federation health status
// POST /api/federation/blacklist       — Add hub to blacklist (admin)
// DELETE /api/federation/blacklist/:hubUrl — Remove from blacklist (admin)
// GET  /api/federation/blacklist       — List blacklisted hubs (admin)
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const federation_1 = require("../federation");
const server_1 = require("../server");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const router = (0, express_1.Router)();
// ─── POST /handshake ──────────────────────────────────────────────────────────
router.post('/handshake', (req, res) => {
    const { handshake } = req.body;
    if (!handshake?.hubUrl || !handshake.publicKey || !handshake.ts || !handshake.signature) {
        return res.status(400).json({ error: 'invalid_handshake', required: ['hubUrl', 'publicKey', 'ts', 'signature'] });
    }
    try {
        const mgr = (0, federation_1.getFederationManager)();
        mgr.processInboundHandshake(handshake);
        const { publicKey } = (0, server_1.getHubKeys)();
        const myUrl = process.env.HUB_URL ?? `http://localhost:${process.env.HUB_PORT ?? 3100}`;
        return res.json({
            status: 'ok',
            hub: {
                url: myUrl,
                publicKey,
                displayName: process.env.HUB_DISPLAY_NAME,
            },
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[federation] Handshake error:', msg);
        return res.status(400).json({ error: 'handshake_failed', message: msg });
    }
});
// ─── POST /message ────────────────────────────────────────────────────────────
router.post('/message', (req, res) => {
    const { federatedMessage } = req.body;
    if (!federatedMessage?.id || !federatedMessage.fromHub || !federatedMessage.message) {
        return res.status(400).json({ error: 'invalid_federated_message' });
    }
    // M2: validate message type whitelist
    const ALLOWED_MSG_TYPES = ['text', 'business', 'task'];
    const msgType = federatedMessage.message?.type;
    if (msgType && !ALLOWED_MSG_TYPES.includes(msgType)) {
        return res.status(400).json({ error: 'invalid_message_type', message: `Unsupported type "${msgType}". Allowed: ${ALLOWED_MSG_TYPES.join(', ')}` });
    }
    try {
        const mgr = (0, federation_1.getFederationManager)();
        const socialMsg = mgr.receiveFromRemoteHub(federatedMessage);
        // SECURITY: validate toAgent exists locally before marking as delivered
        const toAgent = socialMsg.toAgent;
        if (toAgent) {
            const { directoryStore } = require('../store/directory');
            const { parseHandle } = require('@jackclaw/protocol');
            const parsed = parseHandle(toAgent);
            const profile = parsed
                ? (directoryStore.getProfile(parsed.full) ?? directoryStore.getProfile(`@${parsed.local}`))
                : null;
            if (!profile) {
                return res.status(404).json({ error: 'agent_not_found', message: `Target agent ${toAgent} not found on this hub` });
            }
        }
        // Deliver locally
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { deliverFederatedMessage } = require('../routes/social');
        deliverFederatedMessage(socialMsg);
        return res.json({ status: 'delivered', messageId: federatedMessage.id });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[federation] Receive message error:', msg);
        return res.status(500).json({ error: 'delivery_failed', message: msg });
    }
});
// ─── GET /peers ───────────────────────────────────────────────────────────────
router.get('/peers', (_req, res) => {
    const mgr = (0, federation_1.getFederationManager)();
    const peers = mgr.listPeers();
    return res.json({ peers, count: peers.length });
});
// ─── POST /discover ───────────────────────────────────────────────────────────
router.post('/discover', async (req, res) => {
    const { handle } = req.body;
    if (!handle) {
        return res.status(400).json({ error: 'handle required' });
    }
    const normalized = handle.startsWith('@') ? handle : `@${handle}`;
    // Check if this hub has the handle in its local directory
    const dirFile = require('path').join(process.env.HOME || '~', '.jackclaw', 'hub', 'directory.json');
    let localDir = {};
    try {
        const fs = require('fs');
        if (fs.existsSync(dirFile)) {
            localDir = JSON.parse(fs.readFileSync(dirFile, 'utf-8'));
        }
    }
    catch { /* ignore */ }
    if (localDir[normalized]) {
        const myUrl = process.env.HUB_URL ?? `http://localhost:${process.env.HUB_PORT ?? 3100}`;
        return res.json({ found: true, handle: normalized, hubUrl: myUrl });
    }
    return res.json({ found: false, handle: normalized });
});
// ─── GET /status ──────────────────────────────────────────────────────────────
router.get('/status', (_req, res) => {
    const mgr = (0, federation_1.getFederationManager)();
    const peers = mgr.listPeers();
    const { publicKey } = (0, server_1.getHubKeys)();
    const myUrl = process.env.HUB_URL ?? `http://localhost:${process.env.HUB_PORT ?? 3100}`;
    return res.json({
        hubUrl: myUrl,
        publicKey,
        peerCount: peers.length,
        onlinePeers: peers.filter(p => p.status === 'online').length,
        uptime: mgr.uptimeMs,
    });
});
// ─── RBAC helper: independently verify JWT + require admin/ceo role ───────────
// Federation routes are in the public zone (no global JWT middleware),
// so blacklist routes must verify JWT themselves.
function requireAdmin(req, res) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Unauthorized — Bearer token required' });
        return false;
    }
    try {
        const token = authHeader.slice(7);
        const payload = jsonwebtoken_1.default.verify(token, server_1.JWT_SECRET, { algorithms: ['HS256'] });
        req.jwtPayload = payload;
        const role = payload.role?.toLowerCase();
        if (role !== 'admin' && role !== 'ceo' && role !== 'owner') {
            res.status(403).json({ error: 'Forbidden — admin/ceo role required' });
            return false;
        }
        return true;
    }
    catch {
        res.status(401).json({ error: 'Invalid or expired token' });
        return false;
    }
}
// ─── POST /blacklist (PROTECTED: admin/ceo only) ──────────────────────────────
router.post('/blacklist', (req, res) => {
    if (!requireAdmin(req, res))
        return;
    const { hubUrl, reason } = req.body;
    if (!hubUrl || typeof hubUrl !== 'string') {
        return res.status(400).json({ error: 'hubUrl required' });
    }
    try {
        const mgr = (0, federation_1.getFederationManager)();
        mgr.addToBlacklist(hubUrl, reason ?? 'No reason provided');
        console.log(`[federation] AUDIT: blacklist ADD ${hubUrl} by ${req.jwtPayload?.nodeId ?? 'unknown'}`);
        return res.json({ status: 'ok', hubUrl: hubUrl.replace(/\/$/, ''), reason: reason ?? '' });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return res.status(500).json({ error: 'blacklist_failed', message: msg });
    }
});
// ─── DELETE /blacklist/:hubUrl (PROTECTED: admin/ceo only) ────────────────────
router.delete('/blacklist/:hubUrl', (req, res) => {
    if (!requireAdmin(req, res))
        return;
    const hubUrl = decodeURIComponent(req.params.hubUrl);
    try {
        const mgr = (0, federation_1.getFederationManager)();
        mgr.removeFromBlacklist(hubUrl);
        console.log(`[federation] AUDIT: blacklist REMOVE ${hubUrl} by ${req.jwtPayload?.nodeId ?? 'unknown'}`);
        return res.json({ status: 'ok', hubUrl });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return res.status(500).json({ error: 'blacklist_remove_failed', message: msg });
    }
});
// ─── GET /blacklist (PROTECTED: admin/ceo only) ──────────────────────────────
router.get('/blacklist', (req, res) => {
    if (!requireAdmin(req, res))
        return;
    const mgr = (0, federation_1.getFederationManager)();
    const list = mgr.listBlacklist();
    return res.json({ blacklist: list, count: list.length });
});
exports.default = router;
//# sourceMappingURL=federation.js.map