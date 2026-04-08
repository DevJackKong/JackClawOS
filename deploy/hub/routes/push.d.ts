/**
 * Hub Web Push Routes
 *
 * GET  /api/push/vapid-key   — get VAPID public key (needed by frontend before subscribing)
 * POST /api/push/subscribe   — register a push subscription for a node
 * POST /api/push/unsubscribe — cancel a push subscription
 * POST /api/push/test        — send a test push notification
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=push.d.ts.map