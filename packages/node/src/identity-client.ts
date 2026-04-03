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

import {
  AgentHandle,
  AgentProfile,
  CollaborationInvite,
  CollaborationResponse,
  CollaborationSession,
  TrustRelation,
  HandleRegistration,
  HandleLookupResult,
  parseHandle,
  formatHandle,
  AgentRole,
} from '@jackclaw/protocol'

export interface IdentityClientConfig {
  hubUrl: string
  nodeId: string
  publicKey: string
  defaultRole?: AgentRole
  defaultCapabilities?: string[]
}

export class IdentityClient {
  private hubUrl: string
  private nodeId: string
  private publicKey: string
  private defaultRole: AgentRole
  private defaultCapabilities: string[]

  private myHandle: string | null = null

  constructor(config: IdentityClientConfig) {
    this.hubUrl = config.hubUrl.replace(/\/$/, '')
    this.nodeId = config.nodeId
    this.publicKey = config.publicKey
    this.defaultRole = config.defaultRole ?? 'member'
    this.defaultCapabilities = config.defaultCapabilities ?? []
  }

  // ─── Registration ───────────────────────────────────────────────────────────

  async register(handle: string, options?: Partial<HandleRegistration>): Promise<AgentProfile> {
    const parsed = parseHandle(handle)
    if (!parsed) throw new Error(`Invalid handle: ${handle}`)

    const body: HandleRegistration & { nodeId: string } = {
      handle: parsed.local + (parsed.org ? `.${parsed.org}` : ''),
      nodeId: this.nodeId,
      displayName: options?.displayName ?? parsed.local,
      role: options?.role ?? this.defaultRole,
      publicKey: this.publicKey,
      capabilities: options?.capabilities ?? this.defaultCapabilities,
      visibility: options?.visibility ?? 'contacts',
    }

    const res = await fetch(`${this.hubUrl}/api/directory/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const err = await res.json() as { error: string; message?: string }
      throw new Error(`Handle registration failed: ${err.error} — ${err.message ?? ''}`)
    }

    const data = await res.json() as { handle: string; profile: AgentProfile }
    this.myHandle = data.handle
    console.log(`[identity] Registered as ${data.handle}`)
    return data.profile
  }

  get handle(): string | null {
    return this.myHandle
  }

  // ─── Discovery ──────────────────────────────────────────────────────────────

  async lookup(handle: string): Promise<HandleLookupResult> {
    const encoded = encodeURIComponent(handle)
    const res = await fetch(`${this.hubUrl}/api/directory/lookup/${encoded}`)
    return res.json() as Promise<HandleLookupResult>
  }

  async listPublic(): Promise<AgentProfile[]> {
    const res = await fetch(`${this.hubUrl}/api/directory/list`)
    const data = await res.json() as { agents: AgentProfile[] }
    return data.agents
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
  async invite(
    toHandle: string | string[],
    options: {
      topic: string
      context?: string
      capabilities?: string[]
      memoryScope?: CollaborationInvite['memoryScope']
      memoryClearOnEnd?: boolean
      autoAccept?: boolean
    }
  ): Promise<{ inviteId: string; sessionId: string; status: string; session: CollaborationSession }> {
    if (!this.myHandle) throw new Error('Not registered — call register() first')

    const targets = Array.isArray(toHandle) ? toHandle.join(', ') : toHandle

    const body: CollaborationInvite = {
      inviteId: '',  // Hub assigns
      fromHandle: this.myHandle,
      toHandle: targets,
      topic: options.topic,
      context: options.context,
      capabilities: options.capabilities,
      memoryScope: options.memoryScope ?? 'isolated',
      memoryClearOnEnd: options.memoryClearOnEnd ?? false,
      autoAccept: options.autoAccept ?? false,
      createdAt: Date.now(),
    }

    const res = await fetch(`${this.hubUrl}/api/collab/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const err = await res.json() as { error: string; missing?: string[] }
      if (err.missing) throw new Error(`Agent(s) not found: ${err.missing.join(', ')}`)
      throw new Error(`Invite failed: ${err.error}`)
    }

    return res.json() as Promise<{ inviteId: string; sessionId: string; status: string; session: CollaborationSession }>
  }

  /**
   * Respond to a collaboration invitation.
   */
  async respond(
    inviteId: string,
    decision: 'accept' | 'decline' | 'conditional',
    options?: { conditions?: string; message?: string }
  ): Promise<CollaborationSession> {
    if (!this.myHandle) throw new Error('Not registered — call register() first')

    const body: CollaborationResponse = {
      inviteId,
      fromHandle: this.myHandle,
      decision,
      conditions: options?.conditions,
      message: options?.message,
      respondedAt: Date.now(),
    }

    const res = await fetch(`${this.hubUrl}/api/collab/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) throw new Error(`Response failed: ${(await res.json() as any).error}`)
    const data = await res.json() as { session: CollaborationSession }
    return data.session
  }

  /**
   * Pause, resume, or end a collaboration session.
   */
  async updateSession(
    sessionId: string,
    action: 'pause' | 'resume' | 'end',
    outcome?: string
  ): Promise<CollaborationSession> {
    const res = await fetch(`${this.hubUrl}/api/collab/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, outcome }),
    })

    if (!res.ok) throw new Error(`Session update failed: ${(await res.json() as any).error}`)
    const data = await res.json() as { session: CollaborationSession }
    return data.session
  }

  /**
   * List active collaboration sessions for this node.
   */
  async mySessions(status?: CollaborationSession['status']): Promise<CollaborationSession[]> {
    if (!this.myHandle) return []

    const params = new URLSearchParams({ handle: this.myHandle })
    if (status) params.set('status', status)

    const res = await fetch(`${this.hubUrl}/api/collab/sessions?${params}`)
    const data = await res.json() as { sessions: CollaborationSession[] }
    return data.sessions
  }

  // ─── Trust ──────────────────────────────────────────────────────────────────

  async getTrust(toHandle: string): Promise<TrustRelation | null> {
    if (!this.myHandle) return null
    const from = encodeURIComponent(this.myHandle)
    const to = encodeURIComponent(toHandle)
    const res = await fetch(`${this.hubUrl}/api/collab/trust/${from}/${to}`)
    const data = await res.json() as { relation: TrustRelation | null }
    return data.relation
  }
}
