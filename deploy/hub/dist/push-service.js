"use strict";
/**
 * Web Push Notification Service (RFC 8030 / RFC 8291 / RFC 8292)
 *
 * Implements VAPID authentication and AES-128-GCM payload encryption
 * using only Node.js built-in modules (no web-push library dependency).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pushService = exports.PushService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const url_1 = require("url");
// ─── HKDF helper ─────────────────────────────────────────────────────────────
function hkdf(salt, ikm, info, len) {
    return Buffer.from(crypto_1.default.hkdfSync('sha256', ikm, salt, info, len));
}
// ─── Payload encryption (RFC 8291 + RFC 8188 aes128gcm) ──────────────────────
function encryptPayload(payload, p256dh, auth) {
    const receiverPublicKey = Buffer.from(p256dh, 'base64url');
    const authSecret = Buffer.from(auth, 'base64url');
    // Sender ephemeral ECDH key pair (P-256)
    const senderECDH = crypto_1.default.createECDH('prime256v1');
    senderECDH.generateKeys();
    const senderPublicKeyRaw = senderECDH.getPublicKey(); // 65 bytes uncompressed
    const sharedSecret = senderECDH.computeSecret(receiverPublicKey);
    // PRK derivation (RFC 8291 §3.4)
    // info = "WebPush: info\0" || ua_public || as_public
    const prk = hkdf(authSecret, sharedSecret, Buffer.concat([Buffer.from('WebPush: info\0'), receiverPublicKey, senderPublicKeyRaw]), 32);
    // Content encryption key + nonce (RFC 8188 §2.3)
    const salt = crypto_1.default.randomBytes(16);
    const cek = hkdf(salt, prk, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
    const nonce = hkdf(salt, prk, Buffer.from('Content-Encoding: nonce\0'), 12);
    // Encrypt payload (last-record padding byte 0x02)
    const padded = Buffer.concat([payload, Buffer.from([0x02])]);
    const cipher = crypto_1.default.createCipheriv('aes-128-gcm', cek, nonce);
    const ciphertext = Buffer.concat([
        cipher.update(padded),
        cipher.final(),
        cipher.getAuthTag(), // 16-byte GCM auth tag
    ]);
    // aes128gcm body: salt(16) || rs(4) || idlen(1) || keyid(65) || ciphertext
    const rs = Buffer.allocUnsafe(4);
    rs.writeUInt32BE(4096, 0);
    return Buffer.concat([salt, rs, Buffer.from([senderPublicKeyRaw.length]), senderPublicKeyRaw, ciphertext]);
}
// ─── VAPID JWT (RFC 8292) ─────────────────────────────────────────────────────
function buildVapidJwt(endpoint, vapidKeys) {
    const { origin } = new url_1.URL(endpoint);
    const b64u = (s) => Buffer.from(s).toString('base64url');
    const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
    const payload = b64u(JSON.stringify({
        aud: origin,
        exp: Math.floor(Date.now() / 1000) + 43200, // 12 hours
        sub: 'mailto:push@jackclaw.local',
    }));
    const signingInput = Buffer.from(`${header}.${payload}`);
    const privateKeyDer = Buffer.from(vapidKeys.privateKeyDer, 'base64');
    const signature = crypto_1.default.sign('SHA256', signingInput, {
        key: privateKeyDer,
        format: 'der',
        type: 'pkcs8',
        dsaEncoding: 'ieee-p1363', // raw r||s, required for ES256
    });
    return `${header}.${payload}.${signature.toString('base64url')}`;
}
// ─── HTTP push sender ─────────────────────────────────────────────────────────
function sendPushRequest(endpoint, body, vapidJwt, vapidPublicKey) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new url_1.URL(endpoint);
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Encoding': 'aes128gcm',
                'Content-Length': String(body.length),
                'Authorization': `vapid t=${vapidJwt},k=${vapidPublicKey}`,
                'TTL': '86400',
            },
        };
        const requester = parsedUrl.protocol === 'https:' ? https_1.default : http_1.default;
        const req = requester.request(options, (res) => {
            res.resume(); // drain body
            const code = res.statusCode ?? 0;
            if (code >= 200 && code < 300) {
                resolve();
            }
            else if (code === 410 || code === 404) {
                // Subscription expired — caller should unsubscribe
                reject(new Error(`PUSH_GONE:${code}`));
            }
            else {
                reject(new Error(`Push HTTP ${code}`));
            }
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}
// ─── PushService ──────────────────────────────────────────────────────────────
class PushService {
    vapidFile;
    subscriptionsFile;
    vapidKeys;
    subscriptions = new Map(); // nodeId → subscription
    constructor(hubDir) {
        this.vapidFile = path_1.default.join(hubDir, 'vapid.json');
        this.subscriptionsFile = path_1.default.join(hubDir, 'push-subscriptions.json');
        fs_1.default.mkdirSync(hubDir, { recursive: true });
        this.loadVapidKeys();
        this.loadSubscriptions();
    }
    // ── VAPID key management ──────────────────────────────────────────────────
    loadVapidKeys() {
        if (fs_1.default.existsSync(this.vapidFile)) {
            try {
                this.vapidKeys = JSON.parse(fs_1.default.readFileSync(this.vapidFile, 'utf-8'));
                console.log('[push] Loaded existing VAPID keys');
                return;
            }
            catch { /* regenerate */ }
        }
        this.vapidKeys = this.generateVapidKeys();
        fs_1.default.writeFileSync(this.vapidFile, JSON.stringify(this.vapidKeys, null, 2), { mode: 0o600 });
        console.log('[push] Generated new VAPID keys');
    }
    generateVapidKeys() {
        const { privateKey, publicKey } = crypto_1.default.generateKeyPairSync('ec', {
            namedCurve: 'P-256',
            publicKeyEncoding: { type: 'spki', format: 'der' },
            privateKeyEncoding: { type: 'pkcs8', format: 'der' },
        });
        // Extract raw 65-byte uncompressed point from SPKI DER (offset 26)
        const publicKeyRaw = publicKey.slice(26);
        return {
            publicKey: publicKeyRaw.toString('base64url'),
            privateKeyDer: privateKey.toString('base64'),
        };
    }
    /** Return the VAPID application server public key for frontend use */
    getVapidPublicKey() {
        return this.vapidKeys.publicKey;
    }
    // ── Subscription management ───────────────────────────────────────────────
    loadSubscriptions() {
        if (fs_1.default.existsSync(this.subscriptionsFile)) {
            try {
                const raw = JSON.parse(fs_1.default.readFileSync(this.subscriptionsFile, 'utf-8'));
                for (const [nodeId, sub] of Object.entries(raw)) {
                    this.subscriptions.set(nodeId, sub);
                }
            }
            catch { /* start fresh */ }
        }
    }
    saveSubscriptions() {
        const obj = {};
        for (const [k, v] of this.subscriptions)
            obj[k] = v;
        fs_1.default.writeFileSync(this.subscriptionsFile, JSON.stringify(obj, null, 2), { mode: 0o600 });
    }
    subscribe(nodeId, subscription) {
        this.subscriptions.set(nodeId, subscription);
        this.saveSubscriptions();
        console.log(`[push] Subscribed: ${nodeId}`);
    }
    unsubscribe(nodeId) {
        if (this.subscriptions.delete(nodeId)) {
            this.saveSubscriptions();
            console.log(`[push] Unsubscribed: ${nodeId}`);
        }
    }
    // ── Push delivery ─────────────────────────────────────────────────────────
    async push(nodeId, payload) {
        const sub = this.subscriptions.get(nodeId);
        if (!sub)
            return false;
        try {
            const body = encryptPayload(Buffer.from(JSON.stringify(payload)), sub.keys.p256dh, sub.keys.auth);
            const jwt = buildVapidJwt(sub.endpoint, this.vapidKeys);
            await sendPushRequest(sub.endpoint, body, jwt, this.vapidKeys.publicKey);
            console.log(`[push] Sent to ${nodeId}`);
            return true;
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.startsWith('PUSH_GONE:')) {
                // Subscription expired; clean it up
                this.unsubscribe(nodeId);
            }
            else {
                console.warn(`[push] Failed for ${nodeId}: ${msg}`);
            }
            return false;
        }
    }
    async pushToAll(payload) {
        const sends = [...this.subscriptions.keys()].map(id => this.push(id, payload));
        await Promise.allSettled(sends);
    }
    subscriptionCount() {
        return this.subscriptions.size;
    }
}
exports.PushService = PushService;
// ─── Singleton ────────────────────────────────────────────────────────────────
const HUB_DIR = path_1.default.join(process.env.HOME || '~', '.jackclaw', 'hub');
exports.pushService = new PushService(HUB_DIR);
//# sourceMappingURL=push-service.js.map