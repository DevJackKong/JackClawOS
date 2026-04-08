"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrgNormStore = void 0;
exports.getOrgNormStore = getOrgNormStore;
/**
 * OrgNorm — 团队规范持久化存储
 * 持久化到 ~/.jackclaw/org/norms.json
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const crypto_1 = __importDefault(require("crypto"));
const STORE_DIR = path_1.default.join(os_1.default.homedir(), '.jackclaw', 'org');
const STORE_FILE = path_1.default.join(STORE_DIR, 'norms.json');
class OrgNormStore {
    norms = [];
    constructor() {
        this.load();
    }
    /** Return all norms */
    list() {
        return [...this.norms];
    }
    /** Get single norm by id */
    get(id) {
        return this.norms.find(n => n.id === id);
    }
    /** Add a new norm */
    add(input) {
        const validCategories = ['code', 'communication', 'process', 'other'];
        const norm = {
            id: crypto_1.default.randomUUID(),
            title: input.title,
            content: input.content,
            category: (input.category && validCategories.includes(input.category)) ? input.category : 'other',
            author: input.author || 'unknown',
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        this.norms.push(norm);
        this.flush();
        return norm;
    }
    /** Update an existing norm, returns updated norm or undefined */
    update(id, fields) {
        const norm = this.norms.find(n => n.id === id);
        if (!norm)
            return undefined;
        if (fields.title !== undefined)
            norm.title = fields.title;
        if (fields.content !== undefined)
            norm.content = fields.content;
        if (fields.category !== undefined)
            norm.category = fields.category;
        if (fields.author !== undefined)
            norm.author = fields.author;
        norm.updatedAt = Date.now();
        this.flush();
        return norm;
    }
    /** Delete norm by id, returns true if found */
    delete(id) {
        const idx = this.norms.findIndex(n => n.id === id);
        if (idx === -1)
            return false;
        this.norms.splice(idx, 1);
        this.flush();
        return true;
    }
    /**
     * Legacy compat: build system prompt inject from norms
     * Maps old scope-based filtering to category-based listing
     */
    buildSystemPromptInject(_role) {
        if (this.norms.length === 0)
            return '';
        const lines = this.norms.map(n => `- [${n.category}] ${n.title}: ${n.content}`).join('\n');
        return `ORGANIZATION NORMS:\n${lines}`;
    }
    load() {
        try {
            fs_1.default.mkdirSync(STORE_DIR, { recursive: true });
            const raw = fs_1.default.readFileSync(STORE_FILE, 'utf-8');
            const data = JSON.parse(raw);
            if (Array.isArray(data))
                this.norms = data;
        }
        catch {
            // file doesn't exist or invalid — start fresh
        }
    }
    flush() {
        fs_1.default.mkdirSync(STORE_DIR, { recursive: true });
        fs_1.default.writeFileSync(STORE_FILE, JSON.stringify(this.norms, null, 2));
    }
}
exports.OrgNormStore = OrgNormStore;
// Singleton
let _store = null;
function getOrgNormStore() {
    if (!_store)
        _store = new OrgNormStore();
    return _store;
}
//# sourceMappingURL=org-norm.js.map