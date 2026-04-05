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
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const federation_1 = require("../federation");
const server_1 = require("../server");
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
    try {
        const mgr = (0, federation_1.getFederationManager)();
        const socialMsg = mgr.receiveFromRemoteHub(federatedMessage);
        // Deliver locally using the social module's deliver function
        // We import it lazily to avoid circular deps
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
// ─── POST /blacklist ──────────────────────────────────────────────────────────
router.post('/blacklist', (req, res) => {
    const { hubUrl, reason } = req.body;
    if (!hubUrl || typeof hubUrl !== 'string') {
        return res.status(400).json({ error: 'hubUrl required' });
    }
    try {
        const mgr = (0, federation_1.getFederationManager)();
        mgr.addToBlacklist(hubUrl, reason ?? 'No reason provided');
        return res.json({ status: 'ok', hubUrl: hubUrl.replace(/\/$/, ''), reason: reason ?? '' });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return res.status(500).json({ error: 'blacklist_failed', message: msg });
    }
});
// ─── DELETE /blacklist/:hubUrl ────────────────────────────────────────────────
router.delete('/blacklist/:hubUrl', (req, res) => {
    const hubUrl = decodeURIComponent(req.params.hubUrl);
    try {
        const mgr = (0, federation_1.getFederationManager)();
        mgr.removeFromBlacklist(hubUrl);
        return res.json({ status: 'ok', hubUrl });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return res.status(500).json({ error: 'blacklist_remove_failed', message: msg });
    }
});
// ─── GET /blacklist ───────────────────────────────────────────────────────────
router.get('/blacklist', (_req, res) => {
    const mgr = (0, federation_1.getFederationManager)();
    const list = mgr.listBlacklist();
    return res.json({ blacklist: list, count: list.length });
});
exports.default = router;
//# sourceMappingURL=federation.js.map