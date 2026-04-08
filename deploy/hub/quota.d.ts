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
export interface QuotaLimits {
    maxFileStorage: number;
    maxMessagePerDay: number;
    maxFileSize: number;
    maxContacts: number;
    maxGroups: number;
}
export type QuotaResource = keyof QuotaLimits;
interface UsageRecord {
    fileStorage: number;
    messageCount: number;
    messageDate: string;
    contacts: number;
    groups: number;
}
export interface QuotaCheckResult {
    allowed: boolean;
    remaining: number;
    limit: number;
    used: number;
}
export declare class QuotaManager {
    private limits;
    constructor();
    /**
     * Check whether a user is allowed to consume `amount` units of `resource`.
     * For fileStorage / fileSize, amount is bytes.
     * For messagePerDay, amount is 1 (one message at a time).
     */
    checkQuota(userId: string, resource: QuotaResource, amount?: number): QuotaCheckResult;
    /**
     * Increment a tracked resource for a user.
     * Call this after the operation succeeds.
     */
    incrementUsage(userId: string, resource: QuotaResource, amount?: number): void;
    /**
     * Directly set a counter (e.g., after a full recount of contacts/groups).
     */
    setUsage(userId: string, resource: QuotaResource, value: number): void;
    /** Return a snapshot of a user's current usage and limits. */
    getUsage(userId: string): UsageRecord & {
        limits: QuotaLimits;
    };
    /** Expose effective limits (merged defaults + config overrides). */
    getLimits(): Readonly<QuotaLimits>;
    private _loadUsage;
    private _getRecord;
}
/** Singleton — import and use throughout route handlers. */
export declare const quotaManager: QuotaManager;
export {};
//# sourceMappingURL=quota.d.ts.map