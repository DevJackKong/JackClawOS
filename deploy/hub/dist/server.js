"use strict";
// JackClaw Hub - Express Server
// Central node for CEO: receives and aggregates agent reports
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JWT_SECRET = void 0;
exports.getHubKeys = getHubKeys;
exports.asyncHandler = asyncHandler;
exports.createServer = createServer;
const express_1 = __importDefault(require("express"));
const morgan_1 = __importDefault(require("morgan"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const security_1 = require("./security");
const register_1 = __importDefault(require("./routes/register"));
const report_1 = __importDefault(require("./routes/report"));
const nodes_1 = __importDefault(require("./routes/nodes"));
const summary_1 = __importDefault(require("./routes/summary"));
const memory_1 = __importDefault(require("./routes/memory"));
const directory_1 = __importDefault(require("./routes/directory"));
const watchdog_1 = __importDefault(require("./routes/watchdog"));
const human_review_1 = __importDefault(require("./routes/human-review"));
const payment_1 = __importDefault(require("./routes/payment"));
const plan_1 = __importDefault(require("./routes/plan"));
const chat_1 = require("./routes/chat");
const humans_1 = __importDefault(require("./routes/humans"));
const teach_1 = __importDefault(require("./routes/teach"));
const org_norm_1 = __importDefault(require("./routes/org-norm"));
const org_memory_1 = __importDefault(require("./routes/org-memory"));
const ask_1 = __importDefault(require("./routes/ask"));
const social_1 = __importDefault(require("./routes/social"));
const auth_1 = __importDefault(require("./routes/auth"));
const files_1 = __importDefault(require("./routes/files"));
const groups_1 = __importDefault(require("./routes/groups"));
const federation_1 = __importDefault(require("./routes/federation"));
const receipt_1 = __importDefault(require("./routes/receipt"));
const trace_1 = __importDefault(require("./routes/trace"));
const health_1 = __importDefault(require("./routes/health"));
const agent_card_1 = __importDefault(require("./routes/agent-card"));
const audit_1 = __importDefault(require("./routes/audit"));
const risk_1 = __importDefault(require("./routes/risk"));
const plugins_1 = __importDefault(require("./routes/plugins"));
const contacts_1 = __importDefault(require("./routes/contacts"));
const dashboard_1 = __importDefault(require("./routes/dashboard"));
const notifications_1 = __importDefault(require("./routes/notifications"));
const config_1 = __importDefault(require("./routes/config"));
const profile_page_1 = __importDefault(require("./routes/profile-page"));
const moltbook_1 = __importDefault(require("./routes/moltbook"));
const tasks_1 = __importDefault(require("./routes/tasks"));
const channels_1 = __importDefault(require("./routes/channels"));
const push_1 = __importDefault(require("./routes/push"));
const search_1 = __importDefault(require("./routes/search"));
const presence_1 = __importDefault(require("./routes/presence"));
const interaction_trace_1 = __importDefault(require("./routes/interaction-trace"));
const chat_context_1 = __importDefault(require("./routes/chat-context"));
const task_state_1 = __importDefault(require("./routes/task-state"));
const approval_1 = __importDefault(require("./routes/approval"));
const webhooks_1 = __importDefault(require("./routes/webhooks"));
const federation_2 = require("./federation");
const event_integration_1 = require("./services/event-integration");
const tunnel_1 = __importDefault(require("./routes/tunnel"));
const agent_session_1 = __importDefault(require("./routes/agent-session"));
const tenant_context_1 = require("./middleware/tenant-context");
const tenant_1 = __importDefault(require("./routes/tenant"));
const org_1 = __importDefault(require("./routes/org"));
const workspace_1 = __importDefault(require("./routes/workspace"));
const members_1 = __importDefault(require("./routes/members"));
const roles_1 = __importDefault(require("./routes/roles"));
const risk_engine_1 = require("./services/risk-engine");
// ─── Hub Configuration ────────────────────────────────────────────────────────
const HUB_DIR = path_1.default.join(process.env.HOME || '~', '.jackclaw', 'hub');
const KEYS_FILE = path_1.default.join(HUB_DIR, 'keys.json');
exports.JWT_SECRET = process.env.JWT_SECRET
    ?? (() => {
        const secretFile = path_1.default.join(HUB_DIR, 'jwt-secret');
        fs_1.default.mkdirSync(HUB_DIR, { recursive: true });
        if (fs_1.default.existsSync(secretFile)) {
            return fs_1.default.readFileSync(secretFile, 'utf-8').trim();
        }
        const secret = crypto_1.default.randomBytes(48).toString('hex');
        fs_1.default.writeFileSync(secretFile, secret, { mode: 0o600 });
        return secret;
    })();
let _hubKeys = null;
function getHubKeys() {
    if (_hubKeys)
        return _hubKeys;
    fs_1.default.mkdirSync(HUB_DIR, { recursive: true });
    if (fs_1.default.existsSync(KEYS_FILE)) {
        try {
            _hubKeys = JSON.parse(fs_1.default.readFileSync(KEYS_FILE, 'utf-8'));
            return _hubKeys;
        }
        catch {
            // regenerate below
        }
    }
    console.log('[hub] Generating RSA-4096 key pair for hub...');
    const { privateKey, publicKey } = crypto_1.default.generateKeyPairSync('rsa', {
        modulusLength: 4096,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    _hubKeys = { publicKey, privateKey };
    fs_1.default.writeFileSync(KEYS_FILE, JSON.stringify(_hubKeys, null, 2), { mode: 0o600 });
    console.log('[hub] Hub key pair generated and saved.');
    return _hubKeys;
}
// ─── Async Handler Wrapper ────────────────────────────────────────────────────
/**
 * Wraps an async route handler so unhandled promise rejections
 * are forwarded to the Express error middleware instead of crashing.
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        fn(req, res, next).catch(next);
    };
}
/**
 * Verify JWT against all active secrets (current + previous keys in rotation window).
 * Falls back to the legacy JWT_SECRET for tokens issued before key rotation was added.
 */
function jwtAuthMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing or invalid Authorization header' });
        return;
    }
    const token = authHeader.slice(7);
    // Try all active rotating keys, then fall back to the legacy static secret
    const secrets = [...security_1.keyRotation.getActiveSecrets(), exports.JWT_SECRET];
    for (const secret of secrets) {
        try {
            const payload = jsonwebtoken_1.default.verify(token, secret, { algorithms: ['HS256'] });
            req.jwtPayload = payload;
            next();
            return;
        }
        catch { /* try next secret */ }
    }
    res.status(401).json({ error: 'Invalid or expired token' });
}
// ─── Server Factory ───────────────────────────────────────────────────────────
function createServer() {
    // Ensure hub keys exist at startup; initialize federation manager
    const { publicKey, privateKey } = getHubKeys();
    const hubUrl = process.env.HUB_URL ?? `http://localhost:${process.env.HUB_PORT ?? 3100}`;
    (0, federation_2.initFederationManager)(hubUrl, publicKey, privateKey);
    // Start JWT key auto-rotation (checks every hour, rotates after 30 days)
    security_1.keyRotation.startAutoRotation();
    const app = (0, express_1.default)();
    // CORS — must be first so preflight OPTIONS requests are handled before other middleware
    app.use((0, security_1.corsConfig)());
    // Content Security Policy + hardening headers
    app.use((0, security_1.cspHeaders)());
    // Body parsing (1MB limit for JSON; file routes handle their own body)
    app.use(express_1.default.json({ limit: '1mb' }));
    // Input sanitization (strip null bytes; enforce size limit pre-parse)
    app.use('/api/', (0, security_1.inputSanitizer)());
    // Request logging
    app.use((0, morgan_1.default)('[:date[iso]] :method :url :status :response-time ms - :res[content-length]'));
    // Global rate limiting: 1000 req/min per IP+nodeId
    app.use('/api/', security_1.rateLimiter.global);
    // Dashboard — serve built React app from dashboard/dist first, then fall back to legacy public/
    const dashboardDist = path_1.default.join(__dirname, '..', '..', 'dashboard', 'dist');
    if (fs_1.default.existsSync(dashboardDist)) {
        app.use(express_1.default.static(dashboardDist));
    }
    const publicDir = path_1.default.join(__dirname, '..', 'public');
    if (fs_1.default.existsSync(publicDir)) {
        app.use(express_1.default.static(publicDir));
    }
    // Health check & observability (no auth)
    app.use('/health', health_1.default);
    // Agent Card discovery (no auth) — A2A + OpenAgents compatible
    app.use('/.well-known', agent_card_1.default);
    // Public: node registration (no JWT required — nodes need a token first)
    app.use('/api/register', register_1.default);
    // Public: user auth — strict rate limits to prevent brute-force and account flooding
    app.post('/api/auth/login', security_1.rateLimiter.login);
    app.post('/api/auth/register', security_1.rateLimiter.register);
    app.use('/api/auth', auth_1.default);
    // Public: ClawChat (nodes authenticate via WebSocket nodeId); message send is rate-limited
    app.post('/api/chat/send', security_1.rateLimiter.message);
    app.use('/api/chat', chat_1.chatRouter);
    // Public: Human accounts — humanToken auth (no JWT needed)
    app.use('/api/humans', humans_1.default);
    // Public: receipt delivery/read status (nodes authenticate via nodeId in body)
    app.use('/api/receipt', receipt_1.default);
    app.use('/api/chat', trace_1.default); // message trace & status
    // Public: inter-hub federation protocol (hub-to-hub, no JWT)
    app.use('/api/federation', federation_1.default);
    app.use('/api/agent', agent_session_1.default);
    // Public: user profile pages (HTML, no JWT)
    app.use('/', profile_page_1.default);
    // Public: cross-node memory sync uses HMAC-SHA256 (not JWT) — must be before jwtAuthMiddleware
    app.use('/api/memory', memory_1.default); // org memory, collab sessions, push/pull
    // Protected: all other routes require JWT
    app.use('/api/', jwtAuthMiddleware);
    // Tenant context: extract tenantId/orgId from JWT or headers for multi-tenant routes
    app.use('/api/tenants', (0, tenant_context_1.tenantContextMiddleware)({ requireTenant: false }), tenant_1.default);
    app.use('/api/orgs', (0, tenant_context_1.tenantContextMiddleware)({ requireTenant: true }), org_1.default);
    app.use('/api/workspaces', (0, tenant_context_1.tenantContextMiddleware)({ requireTenant: true }), workspace_1.default);
    app.use('/api/members', (0, tenant_context_1.tenantContextMiddleware)({ requireTenant: true }), members_1.default);
    app.use('/api/roles', (0, tenant_context_1.tenantContextMiddleware)({ requireTenant: true }), roles_1.default);
    app.use('/api/reports', report_1.default); // POST / — submit node daily report
    app.use('/api/nodes', nodes_1.default); // GET / — list registered nodes; POST /:nodeId/workload
    app.use('/api/summary', summary_1.default); // GET / — daily digest summary
    app.use('/api/directory', directory_1.default); // GET /lookup/:handle, POST /register, /collab/*
    app.use('/api/watchdog', watchdog_1.default); // heartbeat, status, policy, alerts
    app.use('/api/review', human_review_1.default); // human-in-the-loop review requests
    app.use('/api/payment', payment_1.default); // payment requests, approvals, audit
    app.use('/api/plan', plan_1.default); // POST /estimate — task estimation
    app.use('/api/teach', teach_1.default); // knowledge sharing sessions
    app.use('/api/org-norm', org_norm_1.default); // organisation norms CRUD
    app.use('/api/org-memory', org_memory_1.default); // organisation memory CRUD + search
    app.use('/api/ask', ask_1.default); // GET /providers; POST / — LLM proxy
    app.use('/api/social', social_1.default); // social graph: contacts, messages, profiles
    app.use('/api/groups', groups_1.default); // group chat management
    app.use('/api/channels', channels_1.default); // GET / — aggregate node channel status; POST /configure
    app.use('/api/push', push_1.default); // web push: subscribe, unsubscribe, test
    app.use('/api/search', search_1.default); // GET /messages, GET /contacts — full-text search
    // Files: raw body handled in-route; rate-limited separately
    app.use('/api/files', security_1.rateLimiter.upload, files_1.default);
    app.use('/api/moltbook', moltbook_1.default); // Moltbook social integration
    app.use('/api/tasks', tasks_1.default); // async task queue: submit, status, cancel
    app.use('/api/presence', presence_1.default); // GET /:handle, GET /online — presence queries
    app.use('/api/audit', audit_1.default);
    app.use('/api/risk', risk_1.default);
    app.use('/api/plugins', plugins_1.default); // GET / — list plugins; GET /stats; GET /events
    app.use('/api/contacts', contacts_1.default);
    app.use('/api/dashboard', dashboard_1.default);
    app.use('/api/notifications', notifications_1.default);
    app.use('/api/webhooks', webhooks_1.default);
    app.use('/api/config', config_1.default);
    app.use('/api/traces', interaction_trace_1.default);
    app.use('/api/chat-context', chat_context_1.default);
    app.use('/api/task-state', task_state_1.default);
    app.use('/api/approvals', approval_1.default);
    app.use('/tunnel', tunnel_1.default); // WS /tunnel/ws; ANY /tunnel/:nodeId/* — reverse proxy
    // SPA fallback — serve dashboard index.html for all non-API GET requests
    app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api/') || req.path.startsWith('/chat/')) {
            return next();
        }
        const indexPath = path_1.default.join(__dirname, '..', '..', 'dashboard', 'dist', 'index.html');
        if (fs_1.default.existsSync(indexPath)) {
            res.sendFile(indexPath);
        }
        else {
            next();
        }
    });
    // 404 handler
    app.use((_req, res) => {
        res.status(404).json({ error: 'Not found' });
    });
    // Error handler
    app.use((err, _req, res, _next) => {
        console.error('[hub] Unhandled error:', err);
        res.status(500).json({ error: err.message || 'Internal server error', code: 'INTERNAL_ERROR' });
    });
    // Initialize event-trace integration
    (0, event_integration_1.initEventIntegration)();
    (0, risk_engine_1.initDefaultRules)();
    return app;
}
//# sourceMappingURL=server.js.map