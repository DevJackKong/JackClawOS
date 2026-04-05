"use strict";
// JackClaw Hub - Node Registry Store
// Persists to ~/.jackclaw/hub/nodes.json
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerNode = registerNode;
exports.getNode = getNode;
exports.getAllNodes = getAllNodes;
exports.updateLastReport = updateLastReport;
exports.nodeExists = nodeExists;
exports.deriveNodeId = deriveNodeId;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const STORE_DIR = path_1.default.join(process.env.HOME || '~', '.jackclaw', 'hub');
const NODES_FILE = path_1.default.join(STORE_DIR, 'nodes.json');
function ensureDir() {
    fs_1.default.mkdirSync(STORE_DIR, { recursive: true });
}
function readRegistry() {
    ensureDir();
    if (!fs_1.default.existsSync(NODES_FILE)) {
        return { nodes: {}, updatedAt: Date.now() };
    }
    try {
        const raw = fs_1.default.readFileSync(NODES_FILE, 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return { nodes: {}, updatedAt: Date.now() };
    }
}
function writeRegistry(registry) {
    ensureDir();
    registry.updatedAt = Date.now();
    fs_1.default.writeFileSync(NODES_FILE, JSON.stringify(registry, null, 2), 'utf-8');
}
function registerNode(node) {
    const registry = readRegistry();
    const registered = {
        ...node,
        registeredAt: Date.now(),
    };
    registry.nodes[node.nodeId] = registered;
    writeRegistry(registry);
    return registered;
}
function getNode(nodeId) {
    const registry = readRegistry();
    return registry.nodes[nodeId];
}
function getAllNodes() {
    const registry = readRegistry();
    return Object.values(registry.nodes);
}
function updateLastReport(nodeId) {
    const registry = readRegistry();
    if (registry.nodes[nodeId]) {
        registry.nodes[nodeId].lastReportAt = Date.now();
        writeRegistry(registry);
    }
}
function nodeExists(nodeId) {
    const registry = readRegistry();
    return nodeId in registry.nodes;
}
// Generate a stable node ID from publicKey if not provided
function deriveNodeId(publicKey) {
    return crypto_1.default.createHash('sha256').update(publicKey).digest('hex').slice(0, 16);
}
//# sourceMappingURL=nodes.js.map