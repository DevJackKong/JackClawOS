"use strict";
/**
 * JackClaw Hub — Security Middleware
 *
 * Provides: rate limiting, CORS, CSP headers, input sanitization, JWT key rotation.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.keyRotation = exports.rateLimiter = void 0;
exports.corsConfig = corsConfig;
exports.cspHeaders = cspHeaders;
exports.escapeHtml = escapeHtml;
exports.inputSanitizer = inputSanitizer;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// ─── Constants ────────────────────────────────────────────────────────────────
const KEYS_DIR = path_1.default.join(process.env.HOME ?? '~', '.jackclaw', 'hub', 'keys');
const KEYS_STORE_FILE = path_1.default.join(KEYS_DIR, 'jwt-keys.json');
const KEY_ROTATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const KEY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (transition window)
// ─── Rate Limiters ────────────────────────────────────────────────────────────
/**
 * Build a key generator combining IP + nodeId (extracted from JWT payload, if present).
 * This prevents per-IP bypass via spoofed shared proxies and ties limits to the actor.
 */
function makeKeyGenerator(prefix) {
    return (req) => {
        const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
        let nodeId = '';
        const auth = req.headers.authorization;
        if (auth?.startsWith('Bearer ')) {
            try {
                // Decode payload without verifying signature (key is unknown here — just need nodeId)
                const payloadB64 = auth.split('.')[1];
                if (payloadB64) {
                    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
                    nodeId = typeof payload.nodeId === 'string' ? payload.nodeId : '';
                }
            }
            catch { /* malformed token — ignore, ip alone is fine */ }
        }
        return `${prefix}:${ip}:${nodeId}`;
    };
}
const IS_TEST = process.env.NODE_ENV === 'test';
exports.rateLimiter = {
    /** Global: 1000 req/min per IP+nodeId */
    global: (0, express_rate_limit_1.default)({
        windowMs: 60_000,
        max: IS_TEST ? 100_000 : 1000,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: makeKeyGenerator('global'),
        message: { error: 'Too many requests. Limit: 1000/min.' },
    }),
    /** Login: 10 attempts/min per IP+nodeId — brute-force protection */
    login: (0, express_rate_limit_1.default)({
        windowMs: 60_000,
        max: IS_TEST ? 100_000 : 10,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: makeKeyGenerator('login'),
        message: { error: 'Too many login attempts. Please wait 1 minute.' },
        skipSuccessfulRequests: false,
    }),
    /** Register: 10 attempts/hour per IP — prevent account flooding */
    register: (0, express_rate_limit_1.default)({
        windowMs: 60 * 60_000,
        max: IS_TEST ? 100_000 : 10,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: makeKeyGenerator('register'),
        message: { error: 'Too many registration attempts. Please wait 1 hour.' },
    }),
    /** Message send: 60/min per IP+nodeId */
    message: (0, express_rate_limit_1.default)({
        windowMs: 60_000,
        max: IS_TEST ? 100_000 : 60,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: makeKeyGenerator('message'),
        message: { error: 'Message rate limit exceeded. Limit: 60/min.' },
    }),
    /** File upload: 10/min per IP+nodeId */
    upload: (0, express_rate_limit_1.default)({
        windowMs: 60_000,
        max: IS_TEST ? 100_000 : 10,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: makeKeyGenerator('upload'),
        message: { error: 'File upload rate limit exceeded. Limit: 10/min.' },
    }),
};
// ─── CORS ─────────────────────────────────────────────────────────────────────
// Configure via env: comma-separated origin lists.
// CORS_ORIGINS takes precedence; set to "*" to allow all origins (open API mode).
const CORS_WILDCARD = process.env.CORS_ORIGINS === '*';
const DASHBOARD_ORIGINS = (process.env.DASHBOARD_ORIGINS ?? 'http://localhost:3000,http://localhost:5173')
    .split(',').map(s => s.trim()).filter(Boolean);
const FEDERATION_ORIGINS = (process.env.FEDERATION_ORIGINS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);
const CORS_EXTRA = (process.env.CORS_ORIGINS && process.env.CORS_ORIGINS !== '*')
    ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
    : [];
const ALLOWED_ORIGINS = new Set([...DASHBOARD_ORIGINS, ...FEDERATION_ORIGINS, ...CORS_EXTRA]);
/**
 * CORS middleware.
 * - If CORS_ORIGINS=* → allow all origins (open API mode, no credentials).
 * - Otherwise allows Dashboard, federated Hub, and CORS_ORIGINS entries.
 * - Caches preflight responses for 1 hour.
 * - Responds to OPTIONS preflight with 204.
 */
function corsConfig() {
    return (req, res, next) => {
        const origin = req.headers.origin;
        if (CORS_WILDCARD) {
            res.setHeader('Access-Control-Allow-Origin', '*');
        }
        else if (origin && ALLOWED_ORIGINS.has(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
            res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Node-ID');
        res.setHeader('Access-Control-Max-Age', '3600'); // 1h preflight cache
        if (req.method === 'OPTIONS') {
            res.status(204).end();
            return;
        }
        next();
    };
}
// ─── Content Security Policy ──────────────────────────────────────────────────
/**
 * CSP + hardening headers middleware.
 * - default-src 'self'
 * - connect-src allows WebSocket origins derived from allowed origins
 * - img-src allows data: and blob: for file previews
 */
function cspHeaders() {
    // Build WebSocket origins from allowed HTTP origins
    const wsOrigins = [...DASHBOARD_ORIGINS, ...FEDERATION_ORIGINS]
        .map(o => o.replace(/^https?/, 'ws').replace(/^http/, 'ws'))
        .join(' ');
    const policy = [
        `default-src 'self'`,
        `script-src 'self' 'unsafe-inline'`,
        `style-src 'self' 'unsafe-inline'`,
        `img-src 'self' data: blob:`,
        `connect-src 'self' ${wsOrigins} ws://localhost:* wss://localhost:*`,
        `font-src 'self'`,
        `frame-ancestors 'none'`,
        `base-uri 'self'`,
        `form-action 'self'`,
    ].join('; ');
    return (_req, res, next) => {
        res.setHeader('Content-Security-Policy', policy);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        next();
    };
}
// ─── Input Sanitizer ──────────────────────────────────────────────────────────
/** Escape HTML special characters — use this when embedding user input in HTML output. */
function escapeHtml(str) {
    return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[c] ?? c);
}
/** Recursively strip null bytes and ASCII control characters from string values. */
function sanitizeValue(value) {
    if (typeof value === 'string') {
        // Remove null bytes and non-printable control chars (except \t \n \r)
        return value.replace(/\0/g, '').replace(/[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
    }
    if (Array.isArray(value))
        return value.map(sanitizeValue);
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeValue(v)]));
    }
    return value;
}
/**
 * Input sanitizer middleware.
 * - Rejects non-upload bodies over 1MB (before body parsing, via Content-Length).
 * - Strips null bytes and control characters from parsed JSON body.
 * SQL injection protection is handled at the SQLite query layer (parameterized queries).
 */
function inputSanitizer() {
    return (req, res, next) => {
        const contentLength = parseInt(req.headers['content-length'] ?? '0', 10);
        const isUpload = req.path.includes('/upload') || req.path.includes('/file');
        if (!isUpload && contentLength > 1_048_576) {
            res.status(413).json({ error: 'Request body too large. Maximum: 1MB.' });
            return;
        }
        if (req.body && typeof req.body === 'object') {
            req.body = sanitizeValue(req.body);
        }
        next();
    };
}
function loadKeyStore() {
    try {
        if (fs_1.default.existsSync(KEYS_STORE_FILE))
            return JSON.parse(fs_1.default.readFileSync(KEYS_STORE_FILE, 'utf-8'));
    }
    catch { /* ignore parse errors — regenerate */ }
    return null;
}
function saveKeyStore(store) {
    fs_1.default.mkdirSync(KEYS_DIR, { recursive: true });
    fs_1.default.writeFileSync(KEYS_STORE_FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
}
function generateKey() {
    const now = Date.now();
    return {
        id: crypto_1.default.randomUUID(),
        secret: crypto_1.default.randomBytes(48).toString('hex'),
        createdAt: now,
        expiresAt: now + KEY_ROTATION_MS + KEY_RETENTION_MS,
    };
}
function initKeyStore() {
    const stored = loadKeyStore();
    if (stored)
        return stored;
    const store = { current: generateKey(), previous: [] };
    saveKeyStore(store);
    return store;
}
let _keyStore = initKeyStore();
exports.keyRotation = {
    /** Secret used to sign new JWTs. */
    getCurrentSecret() {
        return _keyStore.current.secret;
    },
    /**
     * All currently valid secrets: current + unexpired previous keys.
     * Use this set for JWT verification so tokens survive key rotation for 7 days.
     */
    getActiveSecrets() {
        const now = Date.now();
        const previousValid = _keyStore.previous
            .filter(k => k.expiresAt > now)
            .map(k => k.secret);
        return [_keyStore.current.secret, ...previousValid];
    },
    /**
     * Rotate the signing key if the current key is older than 30 days.
     * Old key is retained for 7 days so existing tokens remain valid.
     */
    rotateIfNeeded() {
        const now = Date.now();
        if (now - _keyStore.current.createdAt < KEY_ROTATION_MS)
            return false;
        console.log('[security] Rotating JWT signing key...');
        const newKey = generateKey();
        const previous = [_keyStore.current, ..._keyStore.previous]
            .filter(k => k.expiresAt > now); // prune fully expired keys
        _keyStore = { current: newKey, previous };
        saveKeyStore(_keyStore);
        console.log(`[security] JWT key rotated. New key ID: ${newKey.id}`);
        return true;
    },
    /** Start automatic rotation check (runs every hour). Returns the interval handle. */
    startAutoRotation() {
        // Run once immediately in case server was offline during the rotation window
        this.rotateIfNeeded();
        return setInterval(() => { this.rotateIfNeeded(); }, 60 * 60 * 1000);
    },
};
//# sourceMappingURL=security.js.map