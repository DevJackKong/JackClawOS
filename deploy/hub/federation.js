"use strict";
// JackClaw Hub — Federation Manager
// Manages inter-hub peer registration, message routing, and handle discovery
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FederationManager = void 0;
exports.getFederationManager = getFederationManager;
exports.initFederationManager = initFederationManager;
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const HUB_DIR = path_1.default.join(process.env.HOME || '~', '.jackclaw', 'hub');
const FEDERATION_FILE = path_1.default.join(HUB_DIR, 'federation.json');
const BLACKLIST_FILE = path_1.default.join(HUB_DIR, 'federation-blacklist.json');
const HEALTH_INTERVAL_MS = 60_000; // ping peers every 60 s
// ─── Blacklist helpers ────────────────────────────────────────────────────────
function loadBlacklist() {
    try {
        if (fs_1.default.existsSync(BLACKLIST_FILE)) {
            return JSON.parse(fs_1.default.readFileSync(BLACKLIST_FILE, 'utf-8'));
        }
    }
    catch { /* ignore */ }
    return {};
}
function saveBlacklist(bl) {
    fs_1.default.mkdirSync(path_1.default.dirname(BLACKLIST_FILE), { recursive: true });
    fs_1.default.writeFileSync(BLACKLIST_FILE, JSON.stringify(bl, null, 2), 'utf-8');
}
function loadStore() {
    try {
        if (fs_1.default.existsSync(FEDERATION_FILE)) {
            return JSON.parse(fs_1.default.readFileSync(FEDERATION_FILE, 'utf-8'));
        }
    }
    catch { /* ignore parse errors */ }
    return { peers: {}, directory: {} };
}
function saveStore(store) {
    fs_1.default.mkdirSync(path_1.default.dirname(FEDERATION_FILE), { recursive: true });
    fs_1.default.writeFileSync(FEDERATION_FILE, JSON.stringify(store, null, 2), 'utf-8');
}
// ─── HTTP helper ──────────────────────────────────────────────────────────────
function postJSON(url, body, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const parsed = new URL(url);
        const isHttps = parsed.protocol === 'https:';
        const lib = isHttps ? https_1.default : http_1.default;
        const req = lib.request({
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
            },
            timeout: timeoutMs,
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk.toString(); });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                }
                catch {
                    resolve(data);
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
        req.write(payload);
        req.end();
    });
}
function getJSON(url, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const isHttps = parsed.protocol === 'https:';
        const lib = isHttps ? https_1.default : http_1.default;
        const req = lib.request({
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: 'GET',
            timeout: timeoutMs,
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk.toString(); });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                }
                catch {
                    resolve(data);
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
        req.end();
    });
}
// ─── FederationManager ────────────────────────────────────────────────────────
class FederationManager {
    store;
    hubUrl;
    publicKey;
    privateKey;
    startedAt;
    healthTimer = null;
    constructor(hubUrl, publicKey, privateKey) {
        this.hubUrl = hubUrl;
        this.publicKey = publicKey;
        this.privateKey = privateKey;
        this.startedAt = Date.now();
        this.store = loadStore();
        this._startHealthCheck();
    }
    // ─── Peer management ───────────────────────────────────────────────────────
    /**
     * Register a remote hub as a peer by performing a handshake.
     * The remote hub is expected to have a POST /api/federation/handshake endpoint.
     */
    async registerPeer(hubUrl) {
        const normalizedUrl = hubUrl.replace(/\/$/, '');
        const handshake = this._buildHandshake();
        const result = await postJSON(`${normalizedUrl}/api/federation/handshake`, { handshake });
        if (result.status !== 'ok' || !result.hub?.publicKey) {
            throw new Error(`Handshake with ${normalizedUrl} failed: ${JSON.stringify(result)}`);
        }
        const peer = {
            url: result.hub.url || normalizedUrl,
            publicKey: result.hub.publicKey,
            displayName: result.hub.displayName,
            status: 'online',
            lastSeen: Date.now(),
            registeredAt: this.store.peers[normalizedUrl]?.registeredAt ?? Date.now(),
        };
        this.store.peers[normalizedUrl] = peer;
        saveStore(this.store);
        console.log(`[federation] Registered peer: ${normalizedUrl}`);
        return peer;
    }
    /** Remove a peer hub from the registry */
    removePeer(hubUrl) {
        const normalizedUrl = hubUrl.replace(/\/$/, '');
        delete this.store.peers[normalizedUrl];
        // Also remove any directory entries pointing to this hub
        for (const [handle, entry] of Object.entries(this.store.directory)) {
            if (entry.hubUrl === normalizedUrl) {
                delete this.store.directory[handle];
            }
        }
        saveStore(this.store);
        console.log(`[federation] Removed peer: ${normalizedUrl}`);
    }
    /** List all known peer hubs */
    listPeers() {
        return Object.values(this.store.peers);
    }
    // ─── Message routing ───────────────────────────────────────────────────────
    /**
     * Route a SocialMessage to a remote hub.
     * Looks up which hub owns targetHandle, then forwards via federation envelope.
     * Returns 'delivered' | 'queued' | throws on failure.
     */
    async routeToRemoteHub(targetHandle, msg) {
        // Find which peer hosts this handle
        const entry = this.store.directory[targetHandle];
        let targetHubUrl = entry?.hubUrl ?? null;
        // If not in local directory, try to discover
        if (!targetHubUrl) {
            targetHubUrl = await this._discoverHandleInPeers(targetHandle);
        }
        if (!targetHubUrl) {
            throw new Error(`agent_not_found: ${targetHandle} not reachable in federation`);
        }
        const envelope = {
            id: crypto_1.default.randomUUID(),
            fromHub: this.hubUrl,
            toHub: targetHubUrl,
            message: msg,
            federatedAt: Date.now(),
            hubSignature: this._sign(`${crypto_1.default.randomUUID()}${this.hubUrl}${targetHubUrl}${msg.id}`),
        };
        // Re-sign with stable content
        const sigInput = `${envelope.id}${envelope.fromHub}${envelope.toHub}${envelope.message.id}`;
        envelope.hubSignature = this._sign(sigInput);
        const result = await postJSON(`${targetHubUrl}/api/federation/message`, { federatedMessage: envelope });
        return result;
    }
    /**
     * Accept a FederatedMessage that arrived from a remote hub.
     * Returns the inner SocialMessage for local delivery.
     */
    receiveFromRemoteHub(envelope) {
        // Reject messages from blacklisted hubs
        if (this.isBlacklisted(envelope.fromHub)) {
            throw new Error(`Rejected message from blacklisted hub: ${envelope.fromHub}`);
        }
        // SECURITY: Verify sender is a known peer with a stored public key
        const peer = this.store.peers[envelope.fromHub];
        if (!peer) {
            throw new Error(`Unknown hub: ${envelope.fromHub} — handshake required before sending messages`);
        }
        // SECURITY: Verify hubSignature (protocol-defined: id + fromHub + toHub + message.id)
        if (peer.publicKey) {
            if (!envelope.hubSignature) {
                throw new Error(`Missing hubSignature from ${envelope.fromHub}`);
            }
            const sigInput = `${envelope.id}${envelope.fromHub}${envelope.toHub}${envelope.message?.id ?? ''}`;
            if (!this._verify(sigInput, envelope.hubSignature, peer.publicKey)) {
                throw new Error(`Invalid hubSignature from hub: ${envelope.fromHub}`);
            }
        }
        else {
            console.warn(`[federation] WARNING: No public key stored for ${envelope.fromHub} — cannot verify hubSignature`);
        }
        // Update peer's lastSeen
        peer.lastSeen = Date.now();
        peer.status = 'online';
        saveStore(this.store);
        console.log(`[federation] Verified message from ${envelope.fromHub}: ${envelope.message.fromAgent} → ${envelope.message.toAgent}`);
        return envelope.message;
    }
    // ─── Handle discovery ──────────────────────────────────────────────────────
    /**
     * Ask all known peers if they host a given @handle.
     * Returns the hub URL of the first peer that claims to have it, or null.
     */
    async discoverHandle(handle) {
        const normalized = handle.startsWith('@') ? handle : `@${handle}`;
        // Check local directory cache first
        const cached = this.store.directory[normalized];
        if (cached)
            return cached.hubUrl;
        return this._discoverHandleInPeers(normalized);
    }
    /**
     * Register a handle → hub mapping in the local federation directory.
     * Called when a remote hub confirms it owns a handle.
     */
    cacheHandleLocation(handle, hubUrl) {
        const normalized = handle.startsWith('@') ? handle : `@${handle}`;
        this.store.directory[normalized] = { hubUrl, lastConfirmed: Date.now() };
        saveStore(this.store);
    }
    /**
     * Register local handles so peers can discover them.
     * @param handles Array of @handle strings hosted on this hub
     */
    announceLocalHandles(handles) {
        for (const h of handles) {
            const normalized = h.startsWith('@') ? h : `@${h}`;
            this.store.directory[normalized] = { hubUrl: this.hubUrl, lastConfirmed: Date.now() };
        }
        saveStore(this.store);
    }
    // ─── Inbound handshake processing ─────────────────────────────────────────
    /**
     * Process an inbound handshake from another hub.
     * Verifies the signature and registers the peer.
     */
    processInboundHandshake(handshake) {
        // Reject replays older than 5 minutes
        if (Date.now() - handshake.ts > 5 * 60 * 1000) {
            throw new Error('Handshake expired (ts too old)');
        }
        const normalizedUrl = handshake.hubUrl.replace(/\/$/, '');
        // Reject blacklisted hubs
        if (this.isBlacklisted(normalizedUrl)) {
            throw new Error(`Hub is blacklisted: ${normalizedUrl}`);
        }
        const sigInput = `${handshake.hubUrl}${handshake.publicKey}${handshake.ts}`;
        if (!this._verify(sigInput, handshake.signature, handshake.publicKey)) {
            throw new Error('Handshake signature invalid');
        }
        const existing = this.store.peers[normalizedUrl];
        const peer = {
            url: normalizedUrl,
            publicKey: handshake.publicKey,
            displayName: handshake.displayName,
            status: 'online',
            lastSeen: Date.now(),
            registeredAt: existing?.registeredAt ?? Date.now(),
        };
        this.store.peers[normalizedUrl] = peer;
        saveStore(this.store);
        console.log(`[federation] Peer registered via handshake: ${normalizedUrl}`);
        return peer;
    }
    // ─── Federation Blacklist ──────────────────────────────────────────────────
    /** Add a hub to the federation blacklist. Removes it from peers as well. */
    addToBlacklist(hubUrl, reason) {
        const normalized = hubUrl.replace(/\/$/, '');
        const bl = loadBlacklist();
        bl[normalized] = { hubUrl: normalized, reason, addedAt: Date.now() };
        saveBlacklist(bl);
        // Also remove from peers so we stop pinging it
        if (this.store.peers[normalized]) {
            delete this.store.peers[normalized];
            saveStore(this.store);
        }
        console.log(`[federation] Blacklisted hub: ${normalized} — ${reason}`);
    }
    /** Remove a hub from the blacklist. */
    removeFromBlacklist(hubUrl) {
        const normalized = hubUrl.replace(/\/$/, '');
        const bl = loadBlacklist();
        if (bl[normalized]) {
            delete bl[normalized];
            saveBlacklist(bl);
            console.log(`[federation] Removed from blacklist: ${normalized}`);
        }
    }
    /** Return true if the hub URL is on the blacklist. */
    isBlacklisted(hubUrl) {
        const normalized = hubUrl.replace(/\/$/, '');
        return normalized in loadBlacklist();
    }
    /** List all blacklisted hubs. */
    listBlacklist() {
        return Object.values(loadBlacklist());
    }
    // ─── Health check ──────────────────────────────────────────────────────────
    /** Ping all known peers and update their status */
    async healthCheck() {
        const peers = Object.values(this.store.peers);
        await Promise.allSettled(peers.map(async (peer) => {
            try {
                await getJSON(`${peer.url}/api/federation/status`, 5000);
                this.store.peers[peer.url].status = 'online';
                this.store.peers[peer.url].lastSeen = Date.now();
            }
            catch {
                this.store.peers[peer.url].status = 'offline';
            }
        }));
        if (peers.length > 0)
            saveStore(this.store);
    }
    /** Uptime in milliseconds */
    get uptimeMs() {
        return Date.now() - this.startedAt;
    }
    /** Stop the periodic health check timer (for clean shutdown) */
    stop() {
        if (this.healthTimer) {
            clearInterval(this.healthTimer);
            this.healthTimer = null;
        }
    }
    // ─── Private helpers ───────────────────────────────────────────────────────
    _buildHandshake() {
        const ts = Date.now();
        const sigInput = `${this.hubUrl}${this.publicKey}${ts}`;
        return {
            hubUrl: this.hubUrl,
            publicKey: this.publicKey,
            ts,
            signature: this._sign(sigInput),
        };
    }
    _sign(input) {
        return crypto_1.default
            .createSign('SHA256')
            .update(input)
            .sign(this.privateKey, 'base64');
    }
    _verify(input, signature, publicKey) {
        try {
            return crypto_1.default
                .createVerify('SHA256')
                .update(input)
                .verify(publicKey, signature, 'base64');
        }
        catch {
            return false;
        }
    }
    async _discoverHandleInPeers(handle) {
        const peers = Object.values(this.store.peers).filter(p => p.status !== 'offline');
        for (const peer of peers) {
            try {
                const result = await postJSON(`${peer.url}/api/federation/discover`, { handle });
                if (result.found && result.hubUrl) {
                    // Cache the result
                    this.store.directory[handle] = { hubUrl: result.hubUrl, lastConfirmed: Date.now() };
                    saveStore(this.store);
                    return result.hubUrl;
                }
            }
            catch {
                // Peer unreachable — mark offline but continue trying others
                this.store.peers[peer.url].status = 'offline';
            }
        }
        return null;
    }
    _startHealthCheck() {
        this.healthTimer = setInterval(() => {
            this.healthCheck().catch(err => {
                console.error('[federation] Health check error:', err);
            });
        }, HEALTH_INTERVAL_MS);
        // Don't block process exit
        if (this.healthTimer.unref)
            this.healthTimer.unref();
    }
}
exports.FederationManager = FederationManager;
// ─── Singleton ────────────────────────────────────────────────────────────────
let _instance = null;
function getFederationManager() {
    if (!_instance) {
        throw new Error('FederationManager not initialized — call initFederationManager() first');
    }
    return _instance;
}
function initFederationManager(hubUrl, publicKey, privateKey) {
    if (_instance)
        return _instance;
    _instance = new FederationManager(hubUrl, publicKey, privateKey);
    return _instance;
}
//# sourceMappingURL=federation.js.map