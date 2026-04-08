export type TeachingState = "pending" | "active" | "completed" | "rejected" | "expired";
export interface TeachingRequest {
    id: string;
    from: string;
    to: string;
    topic: string;
    clearAfterSession: boolean;
    createdAt: number;
    expiresAt: number;
}
export interface TeachingSession {
    id: string;
    request: TeachingRequest;
    state: TeachingState;
    memoryScope: string;
    knowledgeItems: KnowledgeItem[];
    startedAt?: number;
    completedAt?: number;
}
export interface KnowledgeItem {
    id: string;
    topic: string;
    content: string;
    type: "concept" | "procedure" | "example" | "rule";
    addedAt: number;
}
export declare class TeachingProtocol {
    private nodeId;
    private sessions;
    private storePath;
    constructor(nodeId: string);
    createRequest(opts: {
        to: string;
        topic: string;
        clearAfterSession?: boolean;
    }): TeachingRequest;
    acceptRequest(request: TeachingRequest): TeachingSession;
    rejectRequest(requestId: string): void;
    addKnowledge(sessionId: string, item: Omit<KnowledgeItem, "id" | "addedAt">): void;
    complete(sessionId: string): void;
    getActiveSessions(): TeachingSession[];
    private load;
    private save;
}
//# sourceMappingURL=teaching-protocol.d.ts.map