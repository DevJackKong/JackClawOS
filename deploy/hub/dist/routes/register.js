"use strict";
// POST /api/register - Node registration
// Accepts: nodeId, name, role, publicKey
// Returns: hubPublicKey, token (JWT)
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const nodes_1 = require("../store/nodes");
const server_1 = require("../server");
const router = (0, express_1.Router)();
router.post('/', (req, res) => {
    const { nodeId, name, role, publicKey, callbackUrl } = req.body;
    if (!nodeId || !name || !role || !publicKey) {
        res.status(400).json({ error: 'Missing required fields: nodeId, name, role, publicKey', code: 'VALIDATION_ERROR' });
        return;
    }
    // Basic validation
    if (typeof nodeId !== 'string' || nodeId.length > 64) {
        res.status(400).json({ error: 'Invalid nodeId', code: 'VALIDATION_ERROR' });
        return;
    }
    try {
        const existing = (0, nodes_1.nodeExists)(nodeId);
        const node = (0, nodes_1.registerNode)({ nodeId, name, role, publicKey, callbackUrl });
        const token = jsonwebtoken_1.default.sign({ nodeId: node.nodeId, role: node.role }, server_1.JWT_SECRET, { expiresIn: '30d' });
        const { publicKey: hubPublicKey } = (0, server_1.getHubKeys)();
        res.status(existing ? 200 : 201).json({
            success: true,
            action: existing ? 'updated' : 'registered',
            hubPublicKey,
            token,
            node: {
                nodeId: node.nodeId,
                name: node.name,
                role: node.role,
                registeredAt: node.registeredAt,
            },
        });
    }
    catch (err) {
        console.error('[register] Error:', err);
        res.status(500).json({ error: err.message || 'Registration failed', code: 'INTERNAL_ERROR' });
    }
});
exports.default = router;
//# sourceMappingURL=register.js.map