/**
 * Hub Health & Observability API
 *
 * GET /health              → basic health check (public, minimal)
 * GET /health/detailed     → full system status (JWT required)
 * GET /health/metrics      → prometheus-style metrics (JWT required)
 */
export declare const publicHealthRouter: import("express-serve-static-core").Router;
export declare const protectedHealthRouter: import("express-serve-static-core").Router;
export default publicHealthRouter;
//# sourceMappingURL=health.d.ts.map