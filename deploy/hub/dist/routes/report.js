"use strict";
// POST /api/report - Receive encrypted agent report
// JWT-authenticated; decrypts payload and stores it
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const nodes_1 = require("../store/nodes");
const reports_1 = require("../store/reports");
const server_1 = require("../server");
const router = (0, express_1.Router)();
/**
 * Decrypt an EncryptedPayload using the hub's RSA private key + AES-256-GCM.
 * Protocol matches the EncryptedPayload spec in @jackclaw/protocol/types.ts
 */
function decryptPayload(encrypted, privateKeyPem) {
    // Unwrap AES key with RSA-OAEP
    const aesKey = crypto_1.default.privateDecrypt({ key: privateKeyPem, padding: crypto_1.default.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(encrypted.encryptedKey, 'base64'));
    const iv = Buffer.from(encrypted.iv, 'base64');
    const ciphertext = Buffer.from(encrypted.ciphertext, 'base64');
    const authTag = Buffer.from(encrypted.authTag, 'base64');
    const decipher = crypto_1.default.createDecipheriv('aes-256-gcm', aesKey, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf-8');
}
router.post('/', (req, res) => {
    const body = req.body;
    // ── Dev mode: accept plaintext report from authenticated nodes ──
    // If body has 'summary' (plaintext) instead of full JackClawMessage envelope
    if (body.summary && !body.payload && !body.signature) {
        const jwtPayload = req.jwtPayload;
        if (!jwtPayload) {
            res.status(401).json({ error: 'JWT required for plaintext reports' });
            return;
        }
        const entry = {
            nodeId: jwtPayload.nodeId,
            messageId: `${jwtPayload.nodeId}-${Date.now()}`,
            timestamp: Date.now(),
            summary: body.summary,
            period: body.period ?? 'daily',
            visibility: body.visibility ?? 'ceo',
            data: body.data ?? body,
        };
        (0, reports_1.saveReport)(entry);
        (0, nodes_1.updateLastReport)(jwtPayload.nodeId);
        console.log(`[report] Plaintext report from ${jwtPayload.nodeId}: ${body.summary.slice(0, 80)}`);
        res.json({ success: true, messageId: entry.messageId });
        return;
    }
    // ── Production mode: full encrypted JackClawMessage envelope ──
    const message = body;
    if (!message.from || !message.payload || !message.timestamp || !message.signature) {
        res.status(400).json({ error: 'Invalid message format' });
        return;
    }
    const node = (0, nodes_1.getNode)(message.from);
    if (!node) {
        res.status(403).json({ error: 'Unknown node. Please register first.' });
        return;
    }
    // Verify signature
    try {
        const dataToVerify = `${message.from}:${message.to ?? 'hub'}:${message.timestamp}:${message.payload}`;
        const verify = crypto_1.default.createVerify('RSA-SHA256');
        verify.update(dataToVerify);
        const sigValid = verify.verify(node.publicKey, message.signature, 'base64');
        if (!sigValid) {
            res.status(401).json({ error: 'Invalid signature' });
            return;
        }
    }
    catch (err) {
        res.status(401).json({ error: 'Signature verification failed' });
        return;
    }
    // Decrypt payload
    let reportPayload;
    try {
        const { privateKey: hubPrivateKey } = (0, server_1.getHubKeys)();
        const encryptedEnvelope = JSON.parse(Buffer.from(message.payload, 'base64').toString('utf-8'));
        const plaintext = decryptPayload(encryptedEnvelope, hubPrivateKey);
        reportPayload = JSON.parse(plaintext);
    }
    catch (err) {
        res.status(400).json({ error: 'Failed to decrypt payload' });
        return;
    }
    const entry = {
        nodeId: message.from,
        messageId: `${message.from}-${message.timestamp}`,
        timestamp: message.timestamp,
        summary: reportPayload.summary,
        period: reportPayload.period,
        visibility: reportPayload.visibility,
        data: reportPayload.data,
    };
    (0, reports_1.saveReport)(entry);
    (0, nodes_1.updateLastReport)(message.from);
    res.json({ success: true, messageId: entry.messageId });
});
exports.default = router;
//# sourceMappingURL=report.js.map