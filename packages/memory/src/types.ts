// JackClaw Agent Memory — Type Definitions

// ── Legacy三层架构类型（保留向后兼容） ──────────────────────

export type MemoryLayer = 'L1' | 'L2' | 'L3'

export type MemoryCategory =
  | 'user'
  | 'feedback'
  | 'project'
  | 'reference'
  | 'task'
  | 'skill'

export type LegacyMemoryScope =
  | 'private'
  | 'org'
  | `peer:${string}`
  | `team:${string}`

// collab.ts 使用旧的 MemoryScope，需要保留该名称向后兼容
// 注意：新代码请使用 MemoryScope（下方定义），它不含 org/peer/team

export type CollabEndMode = 'discard' | 'archive' | 'publish'
export type TeachEndMode = 'discard' | 'archive' | 'snapshot'
export type CollabIntent = 'collaborate' | 'learn' | 'teach'

export interface LegacyMemoryEntry {
  id: string
  agentId: string
  layer: MemoryLayer
  category: MemoryCategory
  scope: LegacyMemoryScope
  content: string
  tags: string[]
  importance: number       // 0-1，影响压缩优先级
  createdAt: number        // Unix ms
  updatedAt: number        // Unix ms
  expiresAt?: number       // L1 自动设置
  source?: string          // 来源 agentId（教学传播时记录溯源）
}

// 兼容性别名
export type MemoryEntry = LegacyMemoryEntry

export interface CollabSession {
  id: string
  intent: CollabIntent
  initiatorId: string
  peerId: string
  topic?: string
  startedAt: number
  /** 共享一条记忆到协作沙箱 */
  share(content: string, tags?: string[]): LegacyMemoryEntry
  /** 以教学者身份传授知识（intent=teach 时使用） */
  teach(entry: Partial<LegacyMemoryEntry>): LegacyMemoryEntry
  /** 结束协作会话 */
  end(mode: CollabEndMode | TeachEndMode): Promise<void>
}

export interface CollabSessionState {
  id: string
  intent: CollabIntent
  initiatorId: string
  peerId: string
  topic?: string
  status: 'pending' | 'active' | 'ended'
  startedAt: number
  entries: LegacyMemoryEntry[]
  endMode?: CollabEndMode | TeachEndMode
}

export interface RecallOptions {
  layer?: MemoryLayer
  category?: MemoryCategory
  scope?: LegacyMemoryScope
  limit?: number
  minImportance?: number
  tags?: string[]
}

export interface NodeRef {
  nodeId: string
  name: string
  skills: string[]   // L3 中 category=skill 的 tag 列表
}

// ── 新4分类记忆体系 ──────────────────────────────────────────

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference'
export type MemoryScope = 'private' | 'shared' | 'teaching'

export interface MemDir {
  id: string
  type: MemoryType
  nodeId: string
  scope: MemoryScope
  content: string        // 主要内容
  why?: string           // feedback类型：为什么这条规则存在
  howToApply?: string    // feedback类型：如何应用
  tags?: string[]
  createdAt: number
  updatedAt: number
  expiresAt?: number     // 可选过期时间
  teachingSessionId?: string  // 仅teaching scope
  verified?: boolean     // 是否已验证（过时检查）
}

export interface MemoryStats {
  totalEntries: number
  totalChars: number
  byType: Record<MemoryType, number>
  byScope: Record<MemoryScope, number>
  limitWarning: boolean  // 超过25KB或200条时警告
}

export interface MemDirQueryOptions {
  type?: MemoryType
  scope?: MemoryScope
  limit?: number
  tags?: string[]
}
