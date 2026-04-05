/**
 * JackClaw Hub — Audit Logger
 *
 * Append-only JSONL audit trail at ~/.jackclaw/hub/audit.jsonl.
 * Tracks: login, register, message_send, file_upload, admin_action, security_alert.
 *
 * Retention: configurable via ~/.jackclaw/hub/audit-config.json
 * Default: 90 days.  cleanup() rewrites the log dropping expired entries.
 * cleanup() is called automatically at startup.
 */
export type AuditEventType = 'login' | 'register' | 'message_send' | 'file_upload' | 'admin_action' | 'security_alert';
export interface AuditEvent {
    id: string;
    type: AuditEventType;
    timestamp: number;
    ip?: string;
    handle?: string;
    nodeId?: string;
    details: Record<string, unknown>;
}
export interface AuditQueryFilters {
    type?: AuditEventType;
    handle?: string;
    nodeId?: string;
    fromTs?: number;
    toTs?: number;
    /** Max results returned (default 1000, applied from newest) */
    limit?: number;
}
export declare class AuditLogger {
    private readonly logFile;
    readonly retentionDays: number;
    constructor(logFile?: string);
    /**
     * Append an audit event to the log.
     * The file is opened with O_APPEND — safe for concurrent writes on the same host.
     * Entries are never modified or deleted (except by cleanup()).
     */
    log(type: AuditEventType, details: Record<string, unknown> & {
        ip?: string;
        handle?: string;
        nodeId?: string;
    }): void;
    /**
     * Query the audit log.
     * Reads the entire file and filters in-memory.
     */
    query(filters?: AuditQueryFilters): AuditEvent[];
    /**
     * Delete log entries older than retentionDays.
     * Rewrites the log file in-place (atomic via temp file).
     */
    cleanup(): void;
    private _loadConfig;
}
/** Singleton logger — use this in route handlers. */
export declare const auditLogger: AuditLogger;
//# sourceMappingURL=audit-log.d.ts.map