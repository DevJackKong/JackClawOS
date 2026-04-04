/**
 * JackClaw Unified Identity Model
 *
 * 6 concepts, strictly separated at the type level:
 *
 *   1. HumanId       — a human user (e.g., "hu_abc123")
 *   2. AgentHandle   — an Agent's global address (e.g., "@alice.jackclaw")
 *   3. NodeId        — a runtime node instance (e.g., "node-7f3a")
 *   4. HubId         — a Hub instance (e.g., "hub-prod-01")
 *   5. ThreadId      — a conversation thread (e.g., "thread-uuid")
 *   6. DeliveryTarget — where to deliver a message (handle or nodeId)
 *
 * These are branded string types — cannot be accidentally mixed at compile time.
 */

// ─── Branded types ────────────────────────────────────────────────────────────

declare const __brand: unique symbol
type Brand<T, B extends string> = T & { readonly [__brand]: B }

/** Human user identifier */
export type HumanId = Brand<string, 'HumanId'>

/** Agent's global address (@handle) */
export type AgentHandle = Brand<string, 'AgentHandle'>

/** Runtime node instance identifier */
export type NodeId = Brand<string, 'NodeId'>

/** Hub instance identifier */
export type HubId = Brand<string, 'HubId'>

/** Conversation thread identifier */
export type ThreadId = Brand<string, 'ThreadId'>

/** Where to deliver a message — either an AgentHandle or NodeId */
export type DeliveryTarget = AgentHandle | NodeId

// ─── Constructors (runtime validation + branding) ─────────────────────────────

export function humanId(raw: string): HumanId {
  if (!raw || raw.startsWith('@') || raw.startsWith('node-') || raw.startsWith('hub-')) {
    throw new Error(`Invalid HumanId: "${raw}"`)
  }
  return raw as HumanId
}

export function agentHandle(raw: string): AgentHandle {
  const h = raw.startsWith('@') ? raw : `@${raw}`
  return h as AgentHandle
}

export function nodeId(raw: string): NodeId {
  return raw as NodeId
}

export function hubId(raw: string): HubId {
  return raw as HubId
}

export function threadId(raw: string): ThreadId {
  return raw as ThreadId
}

// ─── Type guards ──────────────────────────────────────────────────────────────

export function isAgentHandle(s: string): s is AgentHandle {
  return s.startsWith('@')
}

export function isNodeId(s: string): s is NodeId {
  return !s.startsWith('@') && !s.startsWith('hu_') && !s.startsWith('hub-') && !s.startsWith('thread-')
}

export function isHumanId(s: string): s is HumanId {
  return s.startsWith('hu_')
}

// ─── Identity resolution ──────────────────────────────────────────────────────

/** Maps between identity types */
export interface IdentityMapping {
  humanId?: HumanId
  agentHandle: AgentHandle
  nodeId: NodeId
  hubId: HubId
}

/** Registry interface for identity resolution */
export interface IdentityResolver {
  /** Resolve an AgentHandle to its current NodeId */
  resolveHandle(handle: AgentHandle): NodeId | null
  /** Get the HumanId associated with an AgentHandle */
  getHuman(handle: AgentHandle): HumanId | null
  /** Get all handles registered to a NodeId */
  getHandlesForNode(nodeId: NodeId): AgentHandle[]
  /** Get the HubId for a given handle */
  getHub(handle: AgentHandle): HubId | null
}
