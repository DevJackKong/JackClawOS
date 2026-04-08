"use strict";
/**
 * AI Message Filter — rules-based engine (no LLM dependency)
 *
 * Config: ~/.jackclaw/node/filter.json
 * Log:    ~/.jackclaw/node/filter-log.jsonl
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageFilter = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const FILTER_DIR = path_1.default.join(os_1.default.homedir(), '.jackclaw', 'node');
const CONFIG_FILE = path_1.default.join(FILTER_DIR, 'filter.json');
const LOG_FILE = path_1.default.join(FILTER_DIR, 'filter-log.jsonl');
// Suspicious patterns: IP-based URLs and common URL shorteners
const SUSPICIOUS_URL_RE = /https?:\/\/(\d{1,3}\.){3}\d{1,3}|bit\.ly\/|tinyurl\.com\/|t\.co\/|goo\.gl\//i;
const DEFAULT_CONFIG = {
    whitelist: [],
    blacklist: [],
    keywords: [
        { word: '广告', action: 'flag' },
        { word: 'spam', action: 'flag' },
        { word: '色情', action: 'block' },
        { word: 'phishing', action: 'block' },
    ],
};
class MessageFilter {
    config;
    // rate-limit tracking: handle → arrival timestamps (last 60 s)
    rateBucket = new Map();
    // duplicate detection: handle → { content, ts }[]
    recentContent = new Map();
    // in-memory stats (reset when date changes)
    stats = { date: this._today(), allowed: 0, flagged: 0, blocked: 0 };
    constructor() {
        this.config = this._loadConfig();
        fs_1.default.mkdirSync(FILTER_DIR, { recursive: true });
    }
    /** Analyse an incoming social message and decide what to do with it. */
    analyze(msg) {
        const { fromAgent: handle, content, id } = msg;
        const now = Date.now();
        // 1. Blacklist → always block
        if (this._inList(handle, this.config.blacklist)) {
            return this._record('block', `sender ${handle} is blacklisted`, 1.0, msg);
        }
        // 2. Whitelist → skip all further checks
        if (this._inList(handle, this.config.whitelist)) {
            return this._record('allow', 'whitelisted sender', 1.0, msg);
        }
        // 3. Duplicate content spam (same content from same sender within 5 min)
        const prevContent = (this.recentContent.get(handle) ?? []).filter(e => now - e.ts < 5 * 60_000);
        if (prevContent.some(e => e.content === content)) {
            return this._record('block', 'duplicate content spam', 0.95, msg);
        }
        prevContent.push({ content, ts: now });
        this.recentContent.set(handle, prevContent);
        // 4. Rate limit: > 10 messages in 60 seconds → flag
        const bucket = (this.rateBucket.get(handle) ?? []).filter(t => now - t < 60_000);
        bucket.push(now);
        this.rateBucket.set(handle, bucket);
        if (bucket.length > 10) {
            return this._record('flag', `rate limit exceeded (${bucket.length} msgs/min)`, 0.9, msg);
        }
        // 5. Keyword filter
        const lower = content.toLowerCase();
        for (const { word, action } of this.config.keywords) {
            if (lower.includes(word.toLowerCase())) {
                return this._record(action, `keyword match: "${word}"`, 0.85, msg);
            }
        }
        // 6. Suspicious URL detection
        if (SUSPICIOUS_URL_RE.test(content)) {
            return this._record('flag', 'suspicious URL detected', 0.8, msg);
        }
        return this._record('allow', 'passed all filters', 0.99, msg);
    }
    // ── Whitelist / Blacklist management ────────────────────────────────────────
    addToWhitelist(handle) {
        const h = this._norm(handle);
        if (!this.config.whitelist.includes(h)) {
            this.config.whitelist.push(h);
            this.config.blacklist = this.config.blacklist.filter(x => x !== h);
            this._saveConfig();
        }
    }
    removeFromWhitelist(handle) {
        const h = this._norm(handle);
        this.config.whitelist = this.config.whitelist.filter(x => x !== h);
        this._saveConfig();
    }
    addToBlacklist(handle) {
        const h = this._norm(handle);
        if (!this.config.blacklist.includes(h)) {
            this.config.blacklist.push(h);
            this.config.whitelist = this.config.whitelist.filter(x => x !== h);
            this._saveConfig();
        }
    }
    removeFromBlacklist(handle) {
        const h = this._norm(handle);
        this.config.blacklist = this.config.blacklist.filter(x => x !== h);
        this._saveConfig();
    }
    // ── Keyword management ───────────────────────────────────────────────────────
    addKeyword(word, action) {
        if (!this.config.keywords.some(k => k.word === word)) {
            this.config.keywords.push({ word, action });
            this._saveConfig();
        }
    }
    removeKeyword(word) {
        this.config.keywords = this.config.keywords.filter(k => k.word !== word);
        this._saveConfig();
    }
    // ── Stats / Inspection ───────────────────────────────────────────────────────
    /** Today's in-memory filter statistics. */
    getStats() {
        this._resetIfNewDay();
        return { ...this.stats, total: this.stats.allowed + this.stats.flagged + this.stats.blocked };
    }
    /**
     * Return all log entries where action === 'block' or 'flag',
     * sorted newest first, limited to today.
     */
    getBlocked() {
        if (!fs_1.default.existsSync(LOG_FILE))
            return [];
        const today = this._today();
        return fs_1.default.readFileSync(LOG_FILE, 'utf8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map(l => { try {
            return JSON.parse(l);
        }
        catch {
            return null;
        } })
            .filter((e) => e !== null && new Date(e.ts).toISOString().startsWith(today))
            .reverse();
    }
    getConfig() {
        return { ...this.config, keywords: [...this.config.keywords] };
    }
    // ── Internals ────────────────────────────────────────────────────────────────
    _record(action, reason, confidence, msg) {
        this._resetIfNewDay();
        if (action === 'allow')
            this.stats.allowed++;
        else if (action === 'flag')
            this.stats.flagged++;
        else
            this.stats.blocked++;
        if (action !== 'allow') {
            this._appendLog({
                ts: Date.now(),
                messageId: msg.id,
                fromAgent: msg.fromAgent,
                action,
                reason,
                contentPreview: msg.content.slice(0, 100),
            });
        }
        return { action, reason, confidence };
    }
    _appendLog(entry) {
        try {
            fs_1.default.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
        }
        catch {
            // Non-critical — silently ignore log write failures
        }
    }
    _inList(handle, list) {
        const h = this._norm(handle);
        return list.some(x => x === h || x === handle);
    }
    _norm(handle) {
        return handle.startsWith('@') ? handle : `@${handle}`;
    }
    _today() {
        return new Date().toISOString().split('T')[0];
    }
    _resetIfNewDay() {
        if (this.stats.date !== this._today()) {
            this.stats = { date: this._today(), allowed: 0, flagged: 0, blocked: 0 };
        }
    }
    _loadConfig() {
        if (!fs_1.default.existsSync(CONFIG_FILE)) {
            fs_1.default.mkdirSync(FILTER_DIR, { recursive: true });
            fs_1.default.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
            return { ...DEFAULT_CONFIG, keywords: [...DEFAULT_CONFIG.keywords] };
        }
        try {
            return JSON.parse(fs_1.default.readFileSync(CONFIG_FILE, 'utf8'));
        }
        catch {
            return { ...DEFAULT_CONFIG, keywords: [...DEFAULT_CONFIG.keywords] };
        }
    }
    _saveConfig() {
        try {
            fs_1.default.mkdirSync(FILTER_DIR, { recursive: true });
            fs_1.default.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2));
        }
        catch (err) {
            console.warn('[filter] Failed to save config:', err);
        }
    }
}
exports.MessageFilter = MessageFilter;
//# sourceMappingURL=ai-filter.js.map