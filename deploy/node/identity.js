"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadOrCreateIdentity = loadOrCreateIdentity;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const protocol_1 = require("@jackclaw/protocol");
const crypto_1 = require("crypto");
const IDENTITY_DIR = path_1.default.join(os_1.default.homedir(), '.jackclaw');
const IDENTITY_FILE = path_1.default.join(IDENTITY_DIR, 'identity.json');
/**
 * Derive a stable node ID from the public key.
 */
function deriveNodeId(publicKey) {
    const hash = (0, crypto_1.createHash)('sha256').update(publicKey).digest('hex');
    return `node-${hash.slice(0, 16)}`;
}
/**
 * Load existing identity or generate + persist a new one.
 * Accepts optional overrides from config for display name and role.
 */
function loadOrCreateIdentity(opts) {
    if (fs_1.default.existsSync(IDENTITY_FILE)) {
        const raw = fs_1.default.readFileSync(IDENTITY_FILE, 'utf8');
        const existing = JSON.parse(raw);
        // Merge config overrides
        if (opts?.displayName)
            existing.displayName = opts.displayName;
        if (opts?.role)
            existing.role = opts.role;
        return existing;
    }
    // First run: generate identity
    const kp = (0, protocol_1.generateKeyPair)();
    const hostname = os_1.default.hostname().replace(/\.local$/, '');
    const identity = {
        nodeId: deriveNodeId(kp.publicKey),
        publicKey: kp.publicKey,
        privateKey: kp.privateKey,
        displayName: opts?.displayName ?? `node-${hostname}`,
        role: opts?.role ?? 'worker',
        createdAt: Date.now(),
    };
    fs_1.default.mkdirSync(IDENTITY_DIR, { recursive: true });
    fs_1.default.writeFileSync(IDENTITY_FILE, JSON.stringify(identity, null, 2), { mode: 0o600 });
    console.log(`[identity] Generated new node identity: ${identity.nodeId}`);
    console.log(`[identity] Name: ${identity.displayName}, Role: ${identity.role}`);
    console.log(`[identity] Stored at: ${IDENTITY_FILE}`);
    return identity;
}
//# sourceMappingURL=identity.js.map