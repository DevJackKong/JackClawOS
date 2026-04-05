/**
 * JackClaw Hub — Security Middleware
 *
 * Provides: rate limiting, CORS, CSP headers, input sanitization, JWT key rotation.
 */
import { RequestHandler } from 'express';
export declare const rateLimiter: {
    /** Global: 1000 req/min per IP+nodeId */
    global: import("express-rate-limit").RateLimitRequestHandler;
    /** Login: 10 attempts/min per IP+nodeId — brute-force protection */
    login: import("express-rate-limit").RateLimitRequestHandler;
    /** Register: 5 attempts/min per IP — prevent account flooding */
    register: import("express-rate-limit").RateLimitRequestHandler;
    /** Message send: 60/min per IP+nodeId */
    message: import("express-rate-limit").RateLimitRequestHandler;
    /** File upload: 10/min per IP+nodeId */
    upload: import("express-rate-limit").RateLimitRequestHandler;
};
/**
 * CORS middleware.
 * - If CORS_ORIGINS=* → allow all origins (open API mode, no credentials).
 * - Otherwise allows Dashboard, federated Hub, and CORS_ORIGINS entries.
 * - Caches preflight responses for 1 hour.
 * - Responds to OPTIONS preflight with 204.
 */
export declare function corsConfig(): RequestHandler;
/**
 * CSP + hardening headers middleware.
 * - default-src 'self'
 * - connect-src allows WebSocket origins derived from allowed origins
 * - img-src allows data: and blob: for file previews
 */
export declare function cspHeaders(): RequestHandler;
/** Escape HTML special characters — use this when embedding user input in HTML output. */
export declare function escapeHtml(str: string): string;
/**
 * Input sanitizer middleware.
 * - Rejects non-upload bodies over 1MB (before body parsing, via Content-Length).
 * - Strips null bytes and control characters from parsed JSON body.
 * SQL injection protection is handled at the SQLite query layer (parameterized queries).
 */
export declare function inputSanitizer(): RequestHandler;
export declare const keyRotation: {
    /** Secret used to sign new JWTs. */
    getCurrentSecret(): string;
    /**
     * All currently valid secrets: current + unexpired previous keys.
     * Use this set for JWT verification so tokens survive key rotation for 7 days.
     */
    getActiveSecrets(): string[];
    /**
     * Rotate the signing key if the current key is older than 30 days.
     * Old key is retained for 7 days so existing tokens remain valid.
     */
    rotateIfNeeded(): boolean;
    /** Start automatic rotation check (runs every hour). Returns the interval handle. */
    startAutoRotation(): NodeJS.Timeout;
};
//# sourceMappingURL=security.d.ts.map