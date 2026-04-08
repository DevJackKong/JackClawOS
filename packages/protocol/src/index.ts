// @jackclaw/protocol public API
export * from './types'
export * from './crypto'
export { createMessage, openMessage } from './message'
export * from './identity'
export * from './task-bundle'
export * from './human-in-loop'
export * from './payment-vault'
export * from './social'
export * from './receipt'
export * from './federation'
export * from './concierge'
export * from './agent-session'
// Unified identity model (branded types) — use UI_ prefix to avoid conflict with identity.ts
export {
  type HumanId,
  type NodeId,
  type HubId,
  type ThreadId,
  type DeliveryTarget,
  type AgentHandle as BrandedAgentHandle,
  type IdentityMapping,
  type IdentityResolver,
  humanId,
  agentHandle as brandedAgentHandle,
  nodeId,
  hubId,
  threadId,
  isAgentHandle,
  isNodeId,
  isHumanId,
} from './unified-identity'
