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
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=agent-card.d.ts.map