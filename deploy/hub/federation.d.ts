import type { HubPeer, FederatedMessage, FederationHandshake, FederatedMessageResponse } from '@jackclaw/protocol';
import type { SocialMessage } from '@jackclaw/protocol';
interface BlacklistEntry {
    hubUrl: string;
    reason: string;
    addedAt: number;
}
export declare class FederationManager {
    private store;
    private hubUrl;
    private publicKey;
    private privateKey;
    private startedAt;
    private healthTimer;
    constructor(hubUrl: string, publicKey: string, privateKey: string);
    /**
     * Register a remote hub as a peer by performing a handshake.
     * The remote hub is expected to have a POST /api/federation/handshake endpoint.
     */
    registerPeer(hubUrl: string): Promise<HubPeer>;
    /** Remove a peer hub from the registry */
    removePeer(hubUrl: string): void;
    /** List all known peer hubs */
    listPeers(): HubPeer[];
    /**
     * Route a SocialMessage to a remote hub.
     * Looks up which hub owns targetHandle, then forwards via federation envelope.
     * Returns 'delivered' | 'queued' | throws on failure.
     */
    routeToRemoteHub(targetHandle: string, msg: SocialMessage): Promise<FederatedMessageResponse>;
    /**
     * Accept a FederatedMessage that arrived from a remote hub.
     * Returns the inner SocialMessage for local delivery.
     */
    receiveFromRemoteHub(envelope: FederatedMessage): SocialMessage;
    /**
     * Ask all known peers if they host a given @handle.
     * Returns the hub URL of the first peer that claims to have it, or null.
     */
    discoverHandle(handle: string): Promise<string | null>;
    /**
     * Register a handle → hub mapping in the local federation directory.
     * Called when a remote hub confirms it owns a handle.
     */
    cacheHandleLocation(handle: string, hubUrl: string): void;
    /**
     * Register local handles so peers can discover them.
     * @param handles Array of @handle strings hosted on this hub
     */
    announceLocalHandles(handles: string[]): void;
    /**
     * Process an inbound handshake from another hub.
     * Verifies the signature and registers the peer.
     */
    processInboundHandshake(handshake: FederationHandshake): HubPeer;
    /** Add a hub to the federation blacklist. Removes it from peers as well. */
    addToBlacklist(hubUrl: string, reason: string): void;
    /** Remove a hub from the blacklist. */
    removeFromBlacklist(hubUrl: string): void;
    /** Return true if the hub URL is on the blacklist. */
    isBlacklisted(hubUrl: string): boolean;
    /** List all blacklisted hubs. */
    listBlacklist(): BlacklistEntry[];
    /** Ping all known peers and update their status */
    healthCheck(): Promise<void>;
    /** Uptime in milliseconds */
    get uptimeMs(): number;
    /** Stop the periodic health check timer (for clean shutdown) */
    stop(): void;
    private _buildHandshake;
    private _sign;
    private _verify;
    private _discoverHandleInPeers;
    private _startHealthCheck;
}
export declare function getFederationManager(): FederationManager;
export declare function initFederationManager(hubUrl: string, publicKey: string, privateKey: string): FederationManager;
export {};
//# sourceMappingURL=federation.d.ts.map