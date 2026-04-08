"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWebhookConfig = getWebhookConfig;
exports.queueWebhookEvent = queueWebhookEvent;
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const server_1 = require("../server");
const router = (0, express_1.Router)();
const HUB_DIR = path_1.default.join(process.env.HOME || '~', '.jackclaw', 'hub');
const WEBHOOKS_FILE = path_1.default.join(HUB_DIR, 'webhooks.json');
const ALLOWED_EVENTS = ['message', 'contact_request', 'contact_response'];
function normalizeHandle(handle) {
    const trimmed = handle.trim();
    return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}
function loadWebhooks() {
    try {
        if (fs_1.default.existsSync(WEBHOOKS_FILE)) {
            return JSON.parse(fs_1.default.readFileSync(WEBHOOKS_FILE, 'utf-8'));
        }
    }
    catch {
        // ignore and fall back to empty store
    }
    return {};
}
function saveWebhooks(store) {
    fs_1.default.mkdirSync(path_1.default.dirname(WEBHOOKS_FILE), { recursive: true });
    fs_1.default.writeFileSync(WEBHOOKS_FILE, JSON.stringify(store, null, 2), 'utf-8');
}
function getAuthedHandle(req) {
    const handle = req.jwtPayload?.role === 'user' && typeof req.jwtPayload.nodeId !== 'string'
        ? req.jwtPayload.handle
        : null;
    if (!handle)
        return null;
    return normalizeHandle(handle);
}
function parseEvents(value) {
    if (!Array.isArray(value) || value.length === 0)
        return ['message'];
    const normalized = value
        .filter((event) => typeof event === 'string')
        .map((event) => event.trim())
        .filter((event) => ALLOWED_EVENTS.includes(event));
    return [...new Set(normalized)];
}
function buildSignature(secret, body) {
    return crypto_1.default.createHmac('sha256', secret).update(body).digest('hex');
}
async function postWebhook(config, payload) {
    const body = JSON.stringify(payload);
    const headers = {
        'Content-Type': 'application/json',
    };
    if (config.secret) {
        headers['X-JackClaw-Signature'] = buildSignature(config.secret, body);
    }
    const response = await fetch(config.url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
}
async function postWebhookWithRetry(handle, config, payload) {
    try {
        await postWebhook(config, payload);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[webhooks] Delivery failed for ${handle}: ${message}; retrying in 5s`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        try {
            await postWebhook(config, payload);
        }
        catch (retryError) {
            const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
            console.warn(`[webhooks] Retry failed for ${handle}: ${retryMessage}`);
        }
    }
}
function getWebhookConfig(handle) {
    const store = loadWebhooks();
    return store[normalizeHandle(handle)] ?? null;
}
function queueWebhookEvent(handle, event, data) {
    const normalizedHandle = normalizeHandle(handle);
    const config = getWebhookConfig(normalizedHandle);
    if (!config?.enabled)
        return;
    if (!config.events.includes(event))
        return;
    const payload = {
        event,
        data,
        ts: Date.now(),
    };
    setImmediate(() => {
        void postWebhookWithRetry(normalizedHandle, config, payload);
    });
}
router.get('/', (0, server_1.asyncHandler)(async (req, res) => {
    const handle = getAuthedHandle(req);
    if (!handle) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const config = getWebhookConfig(handle);
    res.json({ handle, webhook: config });
}));
router.post('/', (0, server_1.asyncHandler)(async (req, res) => {
    const handle = getAuthedHandle(req);
    if (!handle) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const { url, secret, events } = req.body ?? {};
    if (typeof url !== 'string' || !url.trim()) {
        res.status(400).json({ error: 'url is required' });
        return;
    }
    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    }
    catch {
        res.status(400).json({ error: 'invalid url' });
        return;
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        res.status(400).json({ error: 'url must be http or https' });
        return;
    }
    const normalizedEvents = parseEvents(events);
    if (normalizedEvents.length === 0) {
        res.status(400).json({ error: 'invalid events', allowed: ALLOWED_EVENTS });
        return;
    }
    const store = loadWebhooks();
    const webhook = {
        url: parsedUrl.toString(),
        secret: typeof secret === 'string' && secret.trim() ? secret.trim() : undefined,
        events: normalizedEvents,
        enabled: true,
    };
    store[handle] = webhook;
    saveWebhooks(store);
    res.json({ handle, webhook });
}));
router.delete('/', (0, server_1.asyncHandler)(async (req, res) => {
    const handle = getAuthedHandle(req);
    if (!handle) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const store = loadWebhooks();
    const existed = Boolean(store[handle]);
    delete store[handle];
    saveWebhooks(store);
    res.json({ handle, deleted: existed });
}));
router.post('/test', (0, server_1.asyncHandler)(async (req, res) => {
    const handle = getAuthedHandle(req);
    if (!handle) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const config = getWebhookConfig(handle);
    if (!config?.enabled) {
        res.status(404).json({ error: 'webhook_not_configured' });
        return;
    }
    const payload = {
        id: `test-${crypto_1.default.randomUUID()}`,
        fromAgent: '@jackclaw.hub',
        toAgent: handle,
        content: 'webhook test',
        type: 'text',
        ts: Date.now(),
        test: true,
    };
    queueWebhookEvent(handle, 'message', payload);
    res.json({ status: 'queued', handle });
}));
exports.default = router;
//# sourceMappingURL=webhooks.js.map