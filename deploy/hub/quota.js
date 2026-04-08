"use strict";
/**
 * JackClaw Hub — Quota Manager
 *
 * Per-user resource limits with persistent usage tracking.
 * Config overrides: ~/.jackclaw/hub/quota.json
 * Usage state:      ~/.jackclaw/hub/quota-usage.json
 *
 * Default limits:
 *   maxFileStorage:    500 MB  (per user, cumulative uploads)
 *   maxMessagePerDay:  1 000   (per user, resets at midnight)
 *   maxFileSize:       50 MB   (single file — enforced at upload)
 *   maxContacts:       500
 *   maxGroups:         50
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.quotaManager = exports.QuotaManager = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// ─── Paths ────────────────────────────────────────────────────────────────────
const HUB_DIR = path_1.default.join(process.env.HOME ?? '~', '.jackclaw', 'hub');
const CONFIG_FILE = path_1.default.join(HUB_DIR, 'quota.json');
const USAGE_FILE = path_1.default.join(HUB_DIR, 'quota-usage.json');
// ─── Defaults ─────────────────────────────────────────────────────────────────
const DEFAULTS = {
    maxFileStorage: 500 * 1024 * 1024, // 500 MB
    maxMessagePerDay: 1_000,
    maxFileSize: 50 * 1024 * 1024, // 50 MB
    maxContacts: 500,
    maxGroups: 50,
};
// ─── Helpers ──────────────────────────────────────────────────────────────────
function todayStr() {
    return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}
function loadJSON(file, fallback) {
    try {
        if (fs_1.default.existsSync(file))
            return JSON.parse(fs_1.default.readFileSync(file, 'utf-8'));
    }
    catch { /* ignore */ }
    return fallback;
}
function saveJSON(file, data) {
    fs_1.default.mkdirSync(path_1.default.dirname(file), { recursive: true });
    fs_1.default.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}
// ─── QuotaManager ─────────────────────────────────────────────────────────────
class QuotaManager {
    limits;
    constructor() {
        const overrides = loadJSON(CONFIG_FILE, {});
        this.limits = { ...DEFAULTS, ...overrides };
    }
    // ─── Public API ─────────────────────────────────────────────────────────────
    /**
     * Check whether a user is allowed to consume `amount` units of `resource`.
     * For fileStorage / fileSize, amount is bytes.
     * For messagePerDay, amount is 1 (one message at a time).
     */
    checkQuota(userId, resource, amount = 1) {
        const usage = this._loadUsage();
        const record = this._getRecord(usage, userId);
        const limit = this.limits[resource];
        let used;
        switch (resource) {
            case 'maxFileStorage':
                used = record.fileStorage;
                break;
            case 'maxMessagePerDay':
                used = record.messageDate === todayStr() ? record.messageCount : 0;
                break;
            case 'maxFileSize':
                // Single-file check: amount IS the file size
                return {
                    allowed: amount <= limit,
                    remaining: Math.max(0, limit - amount),
                    limit,
                    used: amount,
                };
            case 'maxContacts':
                used = record.contacts;
                break;
            case 'maxGroups':
                used = record.groups;
                break;
            default:
                return { allowed: true, remaining: -1, limit: -1, used: 0 };
        }
        const allowed = used + amount <= limit;
        const remaining = Math.max(0, limit - used);
        return { allowed, remaining, limit, used };
    }
    /**
     * Increment a tracked resource for a user.
     * Call this after the operation succeeds.
     */
    incrementUsage(userId, resource, amount = 1) {
        const usage = this._loadUsage();
        const record = this._getRecord(usage, userId);
        switch (resource) {
            case 'maxFileStorage':
                record.fileStorage = Math.max(0, record.fileStorage + amount);
                break;
            case 'maxMessagePerDay': {
                const today = todayStr();
                if (record.messageDate !== today) {
                    record.messageCount = 0;
                    record.messageDate = today;
                }
                record.messageCount += amount;
                break;
            }
            case 'maxContacts':
                record.contacts = Math.max(0, record.contacts + amount);
                break;
            case 'maxGroups':
                record.groups = Math.max(0, record.groups + amount);
                break;
            // maxFileSize is stateless — nothing to persist
        }
        usage[userId] = record;
        saveJSON(USAGE_FILE, usage);
    }
    /**
     * Directly set a counter (e.g., after a full recount of contacts/groups).
     */
    setUsage(userId, resource, value) {
        const usage = this._loadUsage();
        const record = this._getRecord(usage, userId);
        switch (resource) {
            case 'maxFileStorage':
                record.fileStorage = value;
                break;
            case 'maxMessagePerDay':
                record.messageCount = value;
                break;
            case 'maxContacts':
                record.contacts = value;
                break;
            case 'maxGroups':
                record.groups = value;
                break;
        }
        usage[userId] = record;
        saveJSON(USAGE_FILE, usage);
    }
    /** Return a snapshot of a user's current usage and limits. */
    getUsage(userId) {
        const usage = this._loadUsage();
        const record = this._getRecord(usage, userId);
        // Reset daily counter if stale
        if (record.messageDate !== todayStr()) {
            record.messageCount = 0;
            record.messageDate = todayStr();
        }
        return { ...record, limits: { ...this.limits } };
    }
    /** Expose effective limits (merged defaults + config overrides). */
    getLimits() {
        return this.limits;
    }
    // ─── Private ────────────────────────────────────────────────────────────────
    _loadUsage() {
        return loadJSON(USAGE_FILE, {});
    }
    _getRecord(usage, userId) {
        if (!usage[userId]) {
            usage[userId] = {
                fileStorage: 0,
                messageCount: 0,
                messageDate: todayStr(),
                contacts: 0,
                groups: 0,
            };
        }
        return usage[userId];
    }
}
exports.QuotaManager = QuotaManager;
/** Singleton — import and use throughout route handlers. */
exports.quotaManager = new QuotaManager();
//# sourceMappingURL=quota.js.map