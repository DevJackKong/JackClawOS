/**
 * JackClaw Node - Identity Client
 *
 * Manages this node's @handle registration and collaboration interactions.
 * Usage:
 *   const id = new IdentityClient(hubUrl, nodeId, publicKey)
 *   await id.register('@alice.myorg')
 *   await id.invite('@bob', { topic: 'Help with code review', memoryScope: 'teaching' })
 *   await id.respond(inviteId, 'accept')
 */
import { AgentProfile, CollaborationInvite, CollaborationSession, TrustRelation, HandleRegistration, HandleLookupResult, AgentRole } from '@jackclaw/protocol';
export interface IdentityClientConfig {
    hubUrl: string;
    nodeId: string;
    publicKey: string;
    defaultRole?: AgentRole;
    defaultCapabilities?: string[];
}
export declare class IdentityClient {
    private hubUrl;
    private nodeId;
    private publicKey;
    private defaultRole;
    private defaultCapabilities;
    private myHandle;
    constructor(config: IdentityClientConfig);
    register(handle: string, options?: Partial<HandleRegistration>): Promise<AgentProfile>;
    get handle(): string | null;
    lookup(handle: string): Promise<HandleLookupResult>;
    listPublic(): Promise<AgentProfile[]>;
    /**
     * Send a collaboration invitation to one or more agents.
     *
     * Example:
     *   await client.invite('@bob', {
     *     topic: 'Teach me React hooks',
     *     memoryScope: 'teaching',
     *     memoryClearOnEnd: true,
     *   })
     */
    invite(toHandle: string | string[], options: {
        topic: string;
        context?: string;
        capabilities?: string[];
        memoryScope?: CollaborationInvite['memoryScope'];
        memoryClearOnEnd?: boolean;
        autoAccept?: boolean;
    }): Promise<{
        inviteId: string;
        sessionId: string;
        status: string;
        session: CollaborationSession;
    }>;
    /**
     * Respond to a collaboration invitation.
     */
    respond(inviteId: string, decision: 'accept' | 'decline' | 'conditional', options?: {
        conditions?: string;
        message?: string;
    }): Promise<CollaborationSession>;
    /**
     * Pause, resume, or end a collaboration session.
     */
    updateSession(sessionId: string, action: 'pause' | 'resume' | 'end', outcome?: string): Promise<CollaborationSession>;
    /**
     * List active collaboration sessions for this node.
     */
    mySessions(status?: CollaborationSession['status']): Promise<CollaborationSession[]>;
    getTrust(toHandle: string): Promise<TrustRelation | null>;
}
//# sourceMappingURL=identity-client.d.ts.map