/**
 * JackClaw Agent Identity & Addressing System
 *
 * Handles:
 * - Unique @handle registration (e.g., @alice, @mack.myorg)
 * - Collaboration invitations with accept/decline/conditional
 * - Trust levels between agents
 * - Session lifecycle (start / pause / end)
 *
 * Inspired by: Messy Jobs Ch.6 — AI cannot replace human authority because
 * it lacks relational knowledge. JackClaw addresses this by making trust
 * and relationships first-class protocol citizens.
 */

// ─── Handle Format ────────────────────────────────────────────────────────────
// @alice                 → personal agent (short form)
// @alice.myorg           → org-scoped agent
// @cto.acme.jackclaw     → full qualified handle

export interface AgentHandle {
  local: string          // e.g. "alice"
  org?: string           // e.g. "myorg" (optional)
  domain: string         // always "jackclaw"
  full: string           // "@alice.myorg.jackclaw" or "@alice.jackclaw"
}

export function parseHandle(raw: string): AgentHandle | null {
  // Strip leading @
  const stripped = raw.startsWith('@') ? raw.slice(1) : raw
  const parts = stripped.split('.')

  if (parts.length === 1) {
    // @alice → alice.jackclaw
    return { local: parts[0], domain: 'jackclaw', full: `@${parts[0]}.jackclaw` }
  }

  if (parts.length === 2) {
    if (parts[1] === 'jackclaw') {
      // @alice.jackclaw
      return { local: parts[0], domain: 'jackclaw', full: `@${parts[0]}.jackclaw` }
    }
    // @alice.myorg → alice.myorg.jackclaw
    return { local: parts[0], org: parts[1], domain: 'jackclaw', full: `@${parts[0]}.${parts[1]}.jackclaw` }
  }

  if (parts.length === 3 && parts[2] === 'jackclaw') {
    // @alice.myorg.jackclaw
    return { local: parts[0], org: parts[1], domain: 'jackclaw', full: `@${parts[0]}.${parts[1]}.jackclaw` }
  }

  return null
}

export function formatHandle(local: string, org?: string): string {
  return org ? `@${local}.${org}.jackclaw` : `@${local}.jackclaw`
}

// ─── Registered Agent Profile ─────────────────────────────────────────────────

export type AgentRole = 'ceo' | 'executive' | 'member' | 'guest' | 'bot'

export interface AgentProfile {
  nodeId: string             // internal node ID
  handle: string             // full @handle
  displayName: string        // human-readable name
  role: AgentRole
  publicKey: string          // RSA public key PEM
  hubUrl: string             // home Hub URL
  capabilities: string[]     // list of skill/tool names this agent supports
  visibility: 'public' | 'contacts' | 'org' | 'private'
  createdAt: number
  lastSeen?: number
}

// ─── Trust Levels ─────────────────────────────────────────────────────────────
//
// Inspired by Messy Jobs Ch.6: "Trust is accumulated through repeated interaction
// and cannot be algorithmically created"

export type TrustLevel =
  | 'blocked'      // never interact
  | 'unknown'      // first contact, needs confirmation
  | 'pending'      // invitation sent, awaiting response
  | 'contact'      // confirmed single interaction
  | 'colleague'    // multiple successful collaborations
  | 'trusted'      // deep trust, auto-accept invitations

export interface TrustRelation {
  fromHandle: string
  toHandle: string
  level: TrustLevel
  collaborationCount: number
  successRate: number          // 0-1, ratio of successful collaborations
  reputationScore: number      // 0-100
  establishedAt: number
  lastInteractedAt?: number
  notes?: string               // human/agent notes about this relationship
}

// ─── Collaboration Invitation ─────────────────────────────────────────────────
//
// Inspired by Messy Jobs Ch.7: "The implementer's value is in being able to
// start and stop collaboration on demand while maintaining context"

export type CollaborationStatus =
  | 'pending'       // invitation sent
  | 'accepted'      // actively collaborating
  | 'declined'      // refused
  | 'conditional'   // accepted with conditions
  | 'paused'        // temporarily suspended
  | 'ended'         // completed or terminated

export interface CollaborationInvite {
  inviteId: string
  fromHandle: string
  toHandle: string            // can be comma-separated for group invites
  sessionId?: string          // attach to existing session
  topic: string               // what this collaboration is about
  context?: string            // optional context/memory to share
  capabilities?: string[]     // what capabilities are needed from the invitee
  autoAccept?: boolean        // skip confirmation if trust level >= trusted
  memoryScope: 'isolated' | 'shared' | 'teaching'
  memoryClearOnEnd: boolean   // whether to clear teaching memory after session
  expiresAt?: number          // invitation expiry
  createdAt: number
}

export interface CollaborationSession {
  sessionId: string
  inviteId: string
  participants: string[]       // array of @handles
  initiatorHandle: string
  topic: string
  status: CollaborationStatus
  conditions?: string          // conditions if accepted conditionally
  memoryScope: 'isolated' | 'shared' | 'teaching'
  memoryClearOnEnd: boolean
  startedAt?: number
  pausedAt?: number
  endedAt?: number
  outcome?: string             // summary of what was accomplished
  trustDelta?: Record<string, number>  // trust score changes after session
}

// ─── Collaboration Response ───────────────────────────────────────────────────

export interface CollaborationResponse {
  inviteId: string
  fromHandle: string           // the responder
  decision: 'accept' | 'decline' | 'conditional'
  conditions?: string          // if conditional: what conditions
  message?: string             // optional human-readable message
  counterOffer?: Partial<CollaborationInvite>  // propose modified terms
  respondedAt: number
}

// ─── @-Mention Message ────────────────────────────────────────────────────────

export interface MentionMessage {
  messageId: string
  fromHandle: string
  mentions: string[]           // all @handles mentioned
  content: string
  sessionId?: string           // if within a collaboration session
  replyTo?: string             // reply to another message
  timestamp: number
}

// ─── Hub Directory API Types ──────────────────────────────────────────────────

export interface HandleLookupResult {
  found: boolean
  profile?: AgentProfile
  hubUrl?: string              // if on a remote Hub, route via this URL
  isLocal: boolean             // whether this agent is on the same Hub
}

export interface HandleRegistration {
  handle: string               // desired @handle (short form, Hub adds domain)
  displayName: string
  role: AgentRole
  publicKey: string
  capabilities: string[]
  visibility: AgentProfile['visibility']
}

// ─── Protocol Message Extensions ─────────────────────────────────────────────

export type IdentityMessageType =
  | 'handle_register'
  | 'handle_lookup'
  | 'collab_invite'
  | 'collab_response'
  | 'collab_update'            // status change: pause/end
  | 'mention'
  | 'trust_update'

export interface IdentityMessage {
  type: IdentityMessageType
  payload: unknown
  fromHandle: string
  timestamp: number
  signature: string
}
