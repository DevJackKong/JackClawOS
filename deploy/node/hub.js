"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerWithHub = registerWithHub;
exports.sendReportToHub = sendReportToHub;
const axios_1 = __importDefault(require("axios"));
/**
 * Register this node with the Hub.
 * Hub endpoint: POST /api/register
 */
async function registerWithHub(identity, config) {
    const url = `${config.hubUrl}/api/register`;
    const payload = {
        nodeId: identity.nodeId,
        name: identity.displayName ?? identity.nodeId,
        role: identity.role ?? 'worker',
        publicKey: identity.publicKey,
        callbackUrl: config.callbackUrl ?? `http://localhost:${config.port}`,
    };
    try {
        const res = await axios_1.default.post(url, payload, { timeout: 10_000 });
        console.log(`[hub] Registered with Hub at ${url}. Status: ${res.status}`);
    }
    catch (err) {
        const msg = err?.response?.data ?? err?.message ?? String(err);
        console.warn(`[hub] Registration failed (will retry on next start): ${msg}`);
    }
}
/**
 * Send a report message to the Hub.
 * Hub endpoint: POST /api/report
 */
async function sendReportToHub(nodeId, encryptedMessage, config) {
    const url = `${config.hubUrl}/api/report`;
    try {
        const res = await axios_1.default.post(url, { nodeId, message: encryptedMessage }, { timeout: 15_000 });
        console.log(`[hub] Report sent. Status: ${res.status}`);
    }
    catch (err) {
        const msg = err?.response?.data ?? err?.message ?? String(err);
        console.error(`[hub] Failed to send report: ${msg}`);
    }
}
//# sourceMappingURL=hub.js.map