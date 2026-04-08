"use strict";
/**
 * MoltbookClient — native integration with the Moltbook AI Agent social network.
 * Uses Node.js native fetch (no axios). Handles 429 rate limiting with retry-after.
 * Config stored at ~/.jackclaw/node/moltbook.json
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MoltbookClient = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const MOLTBOOK_API = 'https://www.moltbook.com/api/v1';
const CONFIG_DIR = path_1.default.join(os_1.default.homedir(), '.jackclaw', 'node');
const CONFIG_FILE = path_1.default.join(CONFIG_DIR, 'moltbook.json');
// ─── MoltbookClient ───────────────────────────────────────────────────────────
class MoltbookClient {
    apiKey;
    storedConfig = null;
    constructor(apiKey) {
        this.storedConfig = this.loadConfig();
        this.apiKey = apiKey ?? this.storedConfig?.apiKey ?? '';
    }
    // ── Config persistence ─────────────────────────────────────────────────────
    loadConfig() {
        try {
            if (fs_1.default.existsSync(CONFIG_FILE)) {
                return JSON.parse(fs_1.default.readFileSync(CONFIG_FILE, 'utf-8'));
            }
        }
        catch { /* ignore */ }
        return null;
    }
    saveConfig(config) {
        fs_1.default.mkdirSync(CONFIG_DIR, { recursive: true });
        fs_1.default.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
        this.storedConfig = config;
        this.apiKey = config.apiKey;
    }
    isConfigured() { return !!this.apiKey; }
    getStoredConfig() { return this.storedConfig; }
    // ── HTTP core ──────────────────────────────────────────────────────────────
    async request(method, endpoint, body, params) {
        let url = `${MOLTBOOK_API}${endpoint}`;
        if (params && Object.keys(params).length > 0) {
            url += '?' + new URLSearchParams(params).toString();
        }
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };
        if (this.apiKey)
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        const init = { method, headers };
        if (body !== undefined)
            init.body = JSON.stringify(body);
        let res = await fetch(url, init);
        // Rate limit — wait retry-after seconds then retry once
        if (res.status === 429) {
            const retryAfter = parseInt(res.headers.get('retry-after') ?? '60', 10);
            console.log(`[moltbook] Rate limited — waiting ${retryAfter}s before retry`);
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            res = await fetch(url, init);
        }
        if (!res.ok) {
            const text = await res.text().catch(() => res.statusText);
            throw new Error(`Moltbook ${res.status}: ${text}`);
        }
        return res.json();
    }
    // ── Agent ──────────────────────────────────────────────────────────────────
    /** Register a new Agent on Moltbook. Persists returned api_key to config file. */
    async register(name, description) {
        const result = await this.request('POST', '/agents/register', { name, description });
        this.saveConfig({ apiKey: result.api_key, agent: { name, description } });
        console.log(`[moltbook] Registered agent "${name}" — api_key saved to ${CONFIG_FILE}`);
        return result.agent;
    }
    /** Get current Agent info (karma, post counts, etc.) */
    async getMe() {
        return this.request('GET', '/agents/me');
    }
    // ── Posts ──────────────────────────────────────────────────────────────────
    /** Create a new post. Rate limit: 1 post per 30 min. */
    async post(submolt, title, content, url) {
        const body = { submolt, title, content };
        if (url)
            body['url'] = url;
        return this.request('POST', '/posts', body);
    }
    /** Get posts list sorted by hot/new/top/rising */
    async getPosts(sort = 'hot', limit = 20) {
        const result = await this.request('GET', '/posts', undefined, { sort, limit: String(limit) });
        return result.posts ?? [];
    }
    /** Get a single post by ID */
    async getPost(postId) {
        return this.request('GET', `/posts/${postId}`);
    }
    // ── Comments ───────────────────────────────────────────────────────────────
    /** Comment on a post. Rate limit: 50 comments/hour. */
    async comment(postId, content, parentId) {
        const body = { content };
        if (parentId)
            body['parentId'] = parentId;
        return this.request('POST', `/posts/${postId}/comments`, body);
    }
    // ── Voting ─────────────────────────────────────────────────────────────────
    async upvote(postId) {
        await this.request('POST', `/posts/${postId}/upvote`);
    }
    async downvote(postId) {
        await this.request('POST', `/posts/${postId}/downvote`);
    }
    // ── Feed & Search ──────────────────────────────────────────────────────────
    /** Get personalized feed */
    async getFeed(sort = 'hot', limit = 20) {
        const result = await this.request('GET', '/feed', undefined, { sort, limit: String(limit) });
        return result.posts ?? [];
    }
    /** Full-text search */
    async search(query) {
        const result = await this.request('GET', '/search', undefined, { q: query });
        return result.posts ?? [];
    }
    // ── Submolts ───────────────────────────────────────────────────────────────
    async listSubmolts() {
        const result = await this.request('GET', '/submolts');
        return result.submolts ?? [];
    }
    async subscribe(submolt) {
        await this.request('POST', `/submolts/${submolt}/subscribe`);
    }
    async unsubscribe(submolt) {
        await this.request('POST', `/submolts/${submolt}/unsubscribe`);
    }
    // ── Social ─────────────────────────────────────────────────────────────────
    async follow(agentName) {
        await this.request('POST', `/agents/${agentName}/follow`);
    }
    async unfollow(agentName) {
        await this.request('POST', `/agents/${agentName}/unfollow`);
    }
}
exports.MoltbookClient = MoltbookClient;
//# sourceMappingURL=moltbook.js.map