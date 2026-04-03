// Hub 侧 L3 内存存储 — org 共享记忆 + 协作会话

import type { MemoryEntry, NodeRef, CollabSessionState } from '@jackclaw/memory'

const orgMemories: Map<string, MemoryEntry> = new Map()
const collabSessions: Map<string, CollabSessionState> = new Map()
const nodeSkills: Map<string, NodeRef> = new Map()

// ── Org L3 记忆 ──────────────────────────────────────────

export function broadcastMemory(entry: MemoryEntry): void {
  orgMemories.set(entry.id, { ...entry, layer: 'L3', scope: 'org' })
}

export function getOrgMemories(): MemoryEntry[] {
  return [...orgMemories.values()]
}

// ── 技能索引 ─────────────────────────────────────────────

export function registerNodeSkills(nodeId: string, name: string, skills: string[]): void {
  nodeSkills.set(nodeId, { nodeId, name, skills })
}

export function findExpertsBySkill(skill: string): NodeRef[] {
  const lower = skill.toLowerCase()
  return [...nodeSkills.values()].filter(n =>
    n.skills.some(s => s.toLowerCase().includes(lower))
  )
}

// ── 协作会话 ─────────────────────────────────────────────

export function createCollabSession(state: CollabSessionState): void {
  collabSessions.set(state.id, state)
}

export function getCollabSession(id: string): CollabSessionState | undefined {
  return collabSessions.get(id)
}

export function syncCollabSession(id: string, entries: MemoryEntry[]): void {
  const session = collabSessions.get(id)
  if (!session) return
  session.entries.push(...entries)
}

export function endCollabSession(id: string, mode: string): CollabSessionState | undefined {
  const session = collabSessions.get(id)
  if (!session) return undefined
  session.status = 'ended'
  session.endMode = mode as CollabSessionState['endMode']
  collabSessions.delete(id)
  return session
}
