"use strict";
/**
 * Agent Card Discovery — A2A + OpenAgents compatible
 *
 * GET /.well-known/agents.json    → list all public agents (A2A Agent Card format)
 * GET /.well-known/agents/:handle → single agent card
 *
 * Compatible with:
 * - Google A2A Agent Card spec
 * - OpenAgents discovery protocol
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const directory_1 = require("../store/directory");
const router = (0, express_1.Router)();
function profileToCard(profile, hubBaseUrl) {
    return {
        handle: profile.handle,
        name: profile.displayName || profile.handle,
        role: profile.role || 'member',
        capabilities: profile.capabilities || [],
        hubUrl: profile.hubUrl || hubBaseUrl,
        publicKey: profile.publicKey || '',
        visibility: profile.visibility || 'public',
        lastSeen: profile.lastSeen,
        a2a: {
            version: '1.0',
            endpoint: `${profile.hubUrl || hubBaseUrl}/api/a2a`,
            supportedMethods: ['message/send', 'task/create', 'capability/query'],
        },
    };
}
// GET /.well-known/agents.json
router.get('/agents.json', (req, res) => {
    const hubBaseUrl = `${req.protocol}://${req.get('host')}`;
    const publicProfiles = directory_1.directoryStore.listPublic();
    const cards = publicProfiles.map(p => profileToCard(p, hubBaseUrl));
    res.json({
        protocol: 'jackclaw',
        version: '0.2.0',
        hubId: hubBaseUrl,
        agents: cards,
        totalAgents: cards.length,
        discoveredAt: new Date().toISOString(),
    });
});
// GET /.well-known/agents/:handle
router.get('/agents/:handle', (req, res) => {
    const hubBaseUrl = `${req.protocol}://${req.get('host')}`;
    const handle = req.params.handle.startsWith('@') ? req.params.handle : `@${req.params.handle}`;
    const profile = directory_1.directoryStore.getProfile(handle);
    if (!profile) {
        return res.status(404).json({ error: 'Agent not found', handle });
    }
    return res.json(profileToCard(profile, hubBaseUrl));
});
exports.default = router;
//# sourceMappingURL=agent-card.js.map