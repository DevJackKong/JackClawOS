"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrgMemoryStore = void 0;
/**
 * OrgMemory — 组织级共享记忆（Hub 存储，所有 Node 可读）
 * 持久化到 ~/.jackclaw/org/memory.json
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const crypto_1 = __importDefault(require("crypto"));
const STORE_DIR = path_1.default.join(os_1.default.homedir(), '.jackclaw', 'org');
const STORE_FILE = path_1.default.join(STORE_DIR, 'memory.json');
class OrgMemoryStore {
    entries = [];
    constructor() {
        this.load();
    }
    /** Return all entries (newest first) */
    list() {
        return [...this.entries].reverse();
    }
    /** Query with optional type filter and limit */
    query(type, limit = 20) {
        return this.entries
            .filter(e => !type || e.type === type)
            .slice(-limit)
            .reverse();
    }
    /** Get single entry by id */
    get(id) {
        return this.entries.find(e => e.id === id);
    }
    /** Keyword search (case-insensitive includes on content + tags) */
    search(query) {
        const q = query.toLowerCase();
        return this.entries.filter(e => e.content.toLowerCase().includes(q) ||
            e.tags.some(t => t.toLowerCase().includes(q)));
    }
    /** Add a new entry */
    add(input) {
        const entry = {
            id: crypto_1.default.randomUUID(),
            type: input.type,
            content: input.content,
            nodeId: input.nodeId,
            tags: Array.isArray(input.tags) ? input.tags : [],
            createdAt: Date.now(),
        };
        this.entries.push(entry);
        if (this.entries.length > 500)
            this.entries.splice(0, this.entries.length - 500);
        this.flush();
        return entry;
    }
    /** Delete entry by id, returns true if found */
    delete(id) {
        const idx = this.entries.findIndex(e => e.id === id);
        if (idx === -1)
            return false;
        this.entries.splice(idx, 1);
        this.flush();
        return true;
    }
    load() {
        try {
            fs_1.default.mkdirSync(STORE_DIR, { recursive: true });
            const raw = fs_1.default.readFileSync(STORE_FILE, 'utf-8');
            const data = JSON.parse(raw);
            if (Array.isArray(data))
                this.entries = data;
        }
        catch {
            // file doesn't exist or invalid — start fresh
        }
    }
    flush() {
        fs_1.default.mkdirSync(STORE_DIR, { recursive: true });
        fs_1.default.writeFileSync(STORE_FILE, JSON.stringify(this.entries, null, 2));
    }
}
exports.OrgMemoryStore = OrgMemoryStore;
//# sourceMappingURL=org-memory.js.map