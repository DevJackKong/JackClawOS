"use strict";
/**
 * JackClaw Hub - Directory Store
 *
 * Singleton store for handle → AgentProfile mappings.
 * Single source of truth for all handle/node lookups.
 * Used by routes/directory.ts (HTTP handlers) and presence.ts.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.directoryStore = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const HUB_DIR = path_1.default.join(process.env.HOME || '~', '.jackclaw', 'hub');
const DIRECTORY_FILE = path_1.default.join(HUB_DIR, 'directory.json');
function loadJSON(file, defaultVal) {
    try {
        if (fs_1.default.existsSync(file))
            return JSON.parse(fs_1.default.readFileSync(file, 'utf-8'));
    }
    catch { /* ignore */ }
    return defaultVal;
}
function saveJSON(file, data) {
    fs_1.default.mkdirSync(path_1.default.dirname(file), { recursive: true });
    fs_1.default.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}
class DirectoryStore {
    entries;
    constructor() {
        this.entries = loadJSON(DIRECTORY_FILE, {});
    }
    /** Register or update a handle entry. Overwrites if same nodeId. */
    registerHandle(handle, profile) {
        this.entries[handle] = { ...profile, lastSeen: Date.now() };
        this._persist();
    }
    /** Get the nodeId for a handle. Returns null if not registered. */
    getNodeIdForHandle(handle) {
        const key = handle.startsWith('@') ? handle : `@${handle}`;
        return this.entries[key]?.nodeId ?? null;
    }
    /** Get all handles associated with a nodeId. */
    getHandlesForNode(nodeId) {
        return Object.entries(this.entries)
            .filter(([, p]) => p.nodeId === nodeId)
            .map(([h]) => h);
    }
    /** Update nodeId for an existing handle (node reconnects with new ID). */
    updateNodeId(handle, newNodeId) {
        const key = handle.startsWith('@') ? handle : `@${handle}`;
        if (this.entries[key]) {
            this.entries[key].nodeId = newNodeId;
            this._persist();
        }
    }
    /** Remove a handle and clean up all its associations. */
    removeHandle(handle) {
        const key = handle.startsWith('@') ? handle : `@${handle}`;
        delete this.entries[key];
        this._persist();
    }
    /** Get full profile for a handle. */
    getProfile(handle) {
        const key = handle.startsWith('@') ? handle : `@${handle}`;
        return this.entries[key] ?? null;
    }
    /** Update lastSeen timestamp for a handle. */
    touchHandle(handle) {
        const key = handle.startsWith('@') ? handle : `@${handle}`;
        if (this.entries[key]) {
            this.entries[key].lastSeen = Date.now();
            this._persist();
        }
    }
    /** List all public profiles. */
    listPublic() {
        return Object.values(this.entries).filter(p => p.visibility === 'public');
    }
    /** Expose raw entries for backward-compat with route-level code. */
    getAll() {
        return { ...this.entries };
    }
    _persist() {
        saveJSON(DIRECTORY_FILE, this.entries);
    }
}
exports.directoryStore = new DirectoryStore();
//# sourceMappingURL=directory.js.map