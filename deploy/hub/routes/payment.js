"use strict";
// Hub routes - Payment Vault API
// POST /api/payment/submit         — Agent submits a payment request
// GET  /api/payment/pending        — Query pending human-approval requests
// POST /api/payment/approve/:id    — Human approves (X-Human-Token header)
// POST /api/payment/reject/:id     — Human rejects (X-Human-Token header)
// GET  /api/payment/audit/:nodeId  — Read-only audit log
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const payment_vault_1 = require("@jackclaw/payment-vault");
const isSandboxMode = process.env.PAYMENT_SANDBOX === 'true';
// Singleton vault instance — configured from environment
const vault = new payment_vault_1.PaymentVault({
    nodeId: 'hub',
    jurisdiction: process.env.VAULT_JURISDICTION || 'GLOBAL',
    humanTokenSecret: process.env.HUMAN_TOKEN_SECRET || 'change-me-in-production',
    vaultDir: process.env.VAULT_DIR || '',
});
const router = (0, express_1.Router)();
/**
 * POST /api/payment/submit
 * Body: payment request fields (amount, currency, recipient, etc.)
 * Returns: { payment: PaymentRequest }
 */
router.post('/submit', (req, res) => {
    const body = req.body;
    if (!body.amount || !body.currency || !body.recipient || !body.nodeId) {
        res.status(400).json({
            error: 'Missing required fields: amount, currency, recipient, nodeId',
        });
        return;
    }
    try {
        const payment = vault.submit({
            nodeId: body.nodeId,
            handle: body.handle || '',
            amount: body.amount,
            currency: body.currency,
            recipient: body.recipient,
            description: body.description || '',
            category: body.category || 'general',
            jurisdiction: body.jurisdiction || 'GLOBAL',
            paymentMethod: body.paymentMethod || '',
            metadata: body.metadata || {},
        });
        res.status(201).json({ payment, sandboxMode: isSandboxMode });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
/**
 * GET /api/payment/pending
 * Returns: { requests: PaymentRequest[] }
 */
router.get('/pending', (_req, res) => {
    try {
        const requests = vault.getPending();
        res.json({ requests, sandboxMode: isSandboxMode });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
/**
 * POST /api/payment/approve/:requestId
 * Headers: x-human-token: <HMAC token>
 * Returns: { payment: PaymentRequest }
 */
router.post('/approve/:requestId', (req, res) => {
    const { requestId } = req.params;
    const humanToken = req.headers['x-human-token'];
    if (!humanToken) {
        res.status(401).json({ error: 'Missing X-Human-Token header' });
        return;
    }
    try {
        const payment = vault.humanApprove(requestId, humanToken);
        res.json({ payment, sandboxMode: isSandboxMode });
    }
    catch (err) {
        const msg = err.message;
        if (msg.includes('not found')) {
            res.status(404).json({ error: msg });
        }
        else if (msg.includes('Unauthorized')) {
            res.status(403).json({ error: msg });
        }
        else {
            res.status(400).json({ error: msg });
        }
    }
});
/**
 * POST /api/payment/reject/:requestId
 * Headers: x-human-token: <HMAC token>
 * Body: { reason: string }
 * Returns: { payment: PaymentRequest }
 */
router.post('/reject/:requestId', (req, res) => {
    const { requestId } = req.params;
    const humanToken = req.headers['x-human-token'];
    const { reason } = req.body;
    if (!humanToken) {
        res.status(401).json({ error: 'Missing X-Human-Token header' });
        return;
    }
    try {
        const payment = vault.humanReject(requestId, humanToken, reason || 'Rejected by human');
        res.json({ payment, sandboxMode: isSandboxMode });
    }
    catch (err) {
        const msg = err.message;
        if (msg.includes('not found')) {
            res.status(404).json({ error: msg });
        }
        else if (msg.includes('Unauthorized')) {
            res.status(403).json({ error: msg });
        }
        else {
            res.status(400).json({ error: msg });
        }
    }
});
/**
 * GET /api/payment/audit/:nodeId
 * Returns: { entries: PaymentRequest[] }
 */
router.get('/audit/:nodeId', (req, res) => {
    const { nodeId } = req.params;
    try {
        const entries = vault.getAuditLog(nodeId);
        res.json({ entries, sandboxMode: isSandboxMode });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=payment.js.map