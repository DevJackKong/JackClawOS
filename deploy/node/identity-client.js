"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.IdentityClient = void 0;
const protocol_1 = require("@jackclaw/protocol");
class IdentityClient {
    hubUrl;
    nodeId;
    publicKey;
    defaultRole;
    defaultCapabilities;
    myHandle = null;
    constructor(config) {
        this.hubUrl = config.hubUrl.replace(/\/$/, '');
        this.nodeId = config.nodeId;
        this.publicKey = config.publicKey;
        this.defaultRole = config.defaultRole ?? 'member';
        this.defaultCapabilities = config.defaultCapabilities ?? [];
    }
    // ─── Registration ───────────────────────────────────────────────────────────
    async register(handle, options) {
        const parsed = (0, protocol_1.parseHandle)(handle);
        if (!parsed)
            throw new Error(`Invalid handle: ${handle}`);
        const body = {
            handle: parsed.local + (parsed.org ? `.${parsed.org}` : ''),
            nodeId: this.nodeId,
            displayName: options?.displayName ?? parsed.local,
            role: options?.role ?? this.defaultRole,
            publicKey: this.publicKey,
            capabilities: options?.capabilities ?? this.defaultCapabilities,
            visibility: options?.visibility ?? 'contacts',
        };
        const res = await fetch(`${this.hubUrl}/api/directory/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(`Handle registration failed: ${err.error} — ${err.message ?? ''}`);
        }
        const data = await res.json();
        this.myHandle = data.handle;
        console.log(`[identity] Registered as ${data.handle}`);
        return data.profile;
    }
    get handle() {
        return this.myHandle;
    }
    // ─── Discovery ──────────────────────────────────────────────────────────────
    async lookup(handle) {
        const encoded = encodeURIComponent(handle);
        const res = await fetch(`${this.hubUrl}/api/directory/lookup/${encoded}`);
        return res.json();
    }
    async listPublic() {
        const res = await fetch(`${this.hubUrl}/api/directory/list`);
        const data = await res.json();
        return data.agents;
    }
    // ─── Collaboration ──────────────────────────────────────────────────────────
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
    async invite(toHandle, options) {
        if (!this.myHandle)
            throw new Error('Not registered — call register() first');
        const targets = Array.isArray(toHandle) ? toHandle.join(', ') : toHandle;
        const body = {
            inviteId: '', // Hub assigns
            fromHandle: this.myHandle,
            toHandle: targets,
            topic: options.topic,
            context: options.context,
            capabilities: options.capabilities,
            memoryScope: options.memoryScope ?? 'isolated',
            memoryClearOnEnd: options.memoryClearOnEnd ?? false,
            autoAccept: options.autoAccept ?? false,
            createdAt: Date.now(),
        };
        const res = await fetch(`${this.hubUrl}/api/collab/invite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const err = await res.json();
            if (err.missing)
                throw new Error(`Agent(s) not found: ${err.missing.join(', ')}`);
            throw new Error(`Invite failed: ${err.error}`);
        }
        return res.json();
    }
    /**
     * Respond to a collaboration invitation.
     */
    async respond(inviteId, decision, options) {
        if (!this.myHandle)
            throw new Error('Not registered — call register() first');
        const body = {
            inviteId,
            fromHandle: this.myHandle,
            decision,
            conditions: options?.conditions,
            message: options?.message,
            respondedAt: Date.now(),
        };
        const res = await fetch(`${this.hubUrl}/api/collab/respond`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok)
            throw new Error(`Response failed: ${(await res.json()).error}`);
        const data = await res.json();
        return data.session;
    }
    /**
     * Pause, resume, or end a collaboration session.
     */
    async updateSession(sessionId, action, outcome) {
        const res = await fetch(`${this.hubUrl}/api/collab/sessions/${sessionId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, outcome }),
        });
        if (!res.ok)
            throw new Error(`Session update failed: ${(await res.json()).error}`);
        const data = await res.json();
        return data.session;
    }
    /**
     * List active collaboration sessions for this node.
     */
    async mySessions(status) {
        if (!this.myHandle)
            return [];
        const params = new URLSearchParams({ handle: this.myHandle });
        if (status)
            params.set('status', status);
        const res = await fetch(`${this.hubUrl}/api/collab/sessions?${params}`);
        const data = await res.json();
        return data.sessions;
    }
    // ─── Trust ──────────────────────────────────────────────────────────────────
    async getTrust(toHandle) {
        if (!this.myHandle)
            return null;
        const from = encodeURIComponent(this.myHandle);
        const to = encodeURIComponent(toHandle);
        const res = await fetch(`${this.hubUrl}/api/collab/trust/${from}/${to}`);
        const data = await res.json();
        return data.relation;
    }
}
exports.IdentityClient = IdentityClient;
//# sourceMappingURL=identity-client.js.map