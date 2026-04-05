/**
 * JackClaw Hub - Directory Store
 *
 * Singleton store for handle → AgentProfile mappings.
 * Single source of truth for all handle/node lookups.
 * Used by routes/directory.ts (HTTP handlers) and presence.ts.
 */
import type { AgentProfile } from '@jackclaw/protocol';
declare class DirectoryStore {
    private entries;
    constructor();
    /** Register or update a handle entry. Overwrites if same nodeId. */
    registerHandle(handle: string, profile: AgentProfile): void;
    /** Get the nodeId for a handle. Returns null if not registered. */
    getNodeIdForHandle(handle: string): string | null;
    /** Get all handles associated with a nodeId. */
    getHandlesForNode(nodeId: string): string[];
    /** Update nodeId for an existing handle (node reconnects with new ID). */
    updateNodeId(handle: string, newNodeId: string): void;
    /** Remove a handle and clean up all its associations. */
    removeHandle(handle: string): void;
    /** Get full profile for a handle. */
    getProfile(handle: string): AgentProfile | null;
    /** Update lastSeen timestamp for a handle. */
    touchHandle(handle: string): void;
    /** List all public profiles. */
    listPublic(): AgentProfile[];
    /** Expose raw entries for backward-compat with route-level code. */
    getAll(): Record<string, AgentProfile>;
    private _persist;
}
export declare const directoryStore: DirectoryStore;
export {};
//# sourceMappingURL=directory.d.ts.map