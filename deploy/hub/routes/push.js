"use strict";
/**
 * Hub Web Push Routes
 *
 * GET  /api/push/vapid-key   — get VAPID public key (needed by frontend before subscribing)
 * POST /api/push/subscribe   — register a push subscription for a node
 * POST /api/push/unsubscribe — cancel a push subscription
 * POST /api/push/test        — send a test push notification
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const push_service_1 = require("../push-service");
const router = (0, express_1.Router)();
// GET /api/push/vapid-key
// Returns the VAPID application server public key (base64url).
// Frontend must use this when calling PushManager.subscribe({ applicationServerKey }).
router.get('/vapid-key', (_req, res) => {
    res.json({ publicKey: push_service_1.pushService.getVapidPublicKey() });
});
// POST /api/push/subscribe
// Body: { nodeId: string, subscription: PushSubscriptionJSON }
router.post('/subscribe', (req, res) => {
    const { nodeId, subscription } = req.body;
    if (!nodeId || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
        res.status(400).json({ error: 'nodeId and subscription (endpoint, keys.p256dh, keys.auth) required' });
        return;
    }
    push_service_1.pushService.subscribe(nodeId, subscription);
    res.json({ status: 'ok', nodeId });
});
// POST /api/push/unsubscribe
// Body: { nodeId: string }
router.post('/unsubscribe', (req, res) => {
    const { nodeId } = req.body;
    if (!nodeId) {
        res.status(400).json({ error: 'nodeId required' });
        return;
    }
    push_service_1.pushService.unsubscribe(nodeId);
    res.json({ status: 'ok', nodeId });
});
// POST /api/push/test
// Body: { nodeId?: string }  — if omitted, broadcasts to all subscribers
router.post('/test', async (req, res) => {
    const { nodeId } = req.body;
    const payload = {
        title: 'JackClaw Test Push',
        body: `Push notification works! ${new Date().toLocaleTimeString()}`,
        data: { type: 'test' },
    };
    if (nodeId) {
        const sent = await push_service_1.pushService.push(nodeId, payload);
        res.json({ status: sent ? 'sent' : 'no_subscription', nodeId });
    }
    else {
        await push_service_1.pushService.pushToAll(payload);
        res.json({ status: 'broadcast', count: push_service_1.pushService.subscriptionCount() });
    }
});
exports.default = router;
//# sourceMappingURL=push.js.map