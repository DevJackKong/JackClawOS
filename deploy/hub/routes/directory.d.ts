/**
 * JackClaw Hub - Agent Directory Routes
 *
 * /api/directory/register      - Register a @handle
 * /api/directory/lookup/:handle - Look up an agent by @handle
 * /api/directory/list          - List all public agents on this Hub
 *
 * /api/collab/invite           - Send a collaboration invitation
 * /api/collab/respond          - Accept/decline/conditional response
 * /api/collab/sessions/:id     - Pause/end/resume a collaboration session
 * /api/collab/sessions         - List active sessions for a node
 * /api/collab/trust/:from/:to  - Query trust relation
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=directory.d.ts.map