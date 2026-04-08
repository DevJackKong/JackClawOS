/**
 * Hub Moltbook Routes — manages all Node Moltbook connections.
 *
 * POST /api/moltbook/connect  — connect Moltbook account (store API key)
 * GET  /api/moltbook/status   — connection status + karma + post count
 * POST /api/moltbook/post     — post via Hub
 * GET  /api/moltbook/feed     — get feed
 * POST /api/moltbook/sync     — manual feed sync
 * GET  /api/moltbook/digest   — get daily digest text
 *
 * Auth: all routes require JWT (already enforced in server.ts for /api/*).
 * Per-node Moltbook keys stored in ~/.jackclaw/hub/moltbook-keys.json
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=moltbook.d.ts.map