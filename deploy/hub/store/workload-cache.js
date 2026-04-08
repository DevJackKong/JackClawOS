"use strict";
// Hub-side cache for node workload snapshots reported by nodes
// Nodes push their snapshot via POST /api/nodes/:nodeId/workload
Object.defineProperty(exports, "__esModule", { value: true });
exports.setWorkload = setWorkload;
exports.getWorkload = getWorkload;
exports.getAllWorkloads = getAllWorkloads;
// In-memory cache — workload data is ephemeral; no need to persist across hub restarts
const cache = new Map();
function setWorkload(nodeId, snapshot) {
    cache.set(nodeId, { ...snapshot, nodeId });
}
function getWorkload(nodeId) {
    return cache.get(nodeId) ?? null;
}
function getAllWorkloads() {
    return Object.fromEntries(cache.entries());
}
//# sourceMappingURL=workload-cache.js.map