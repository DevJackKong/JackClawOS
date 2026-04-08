export type TrustLevel = "unknown" | "contact" | "colleague" | "trusted" | "deep";
export type TrustEventType = "task-completed" | "task-approved" | "task-rejected" | "task-timeout" | "collab-started" | "collab-completed" | "manual-boost" | "manual-revoke";
export interface TrustEdge {
    from: string;
    to: string;
    score: number;
    level: TrustLevel;
    interactions: number;
    lastInteractedAt: number;
    history: Array<{
        type: TrustEventType;
        delta: number;
        reason?: string;
        timestamp: number;
    }>;
}
export declare class TrustGraph {
    private nodeId;
    private edges;
    private storePath;
    constructor(nodeId: string);
    record(to: string, type: TrustEventType, reason?: string): void;
    getEdge(to: string): TrustEdge | null;
    getTrustLevel(to: string): TrustLevel;
    canAutoAccept(to: string): boolean;
    getTopTrusted(limit?: number): TrustEdge[];
    export(): TrustEdge[];
    private load;
    private save;
}
//# sourceMappingURL=trust-graph.d.ts.map