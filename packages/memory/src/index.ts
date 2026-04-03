// @jackclaw/memory — 公开 API

// ── 新4分类记忆体系 ──────────────────────────────────────────
export { MemoryManager } from './manager.js'
export type {
  MemDir,
  MemoryType,
  MemoryScope,
  MemoryStats,
  MemDirQueryOptions,
} from './types.js'

// ── 旧三层架构（保留向后兼容） ────────────────────────────────
export { L1Cache } from './l1-cache.js'
export { L2Store } from './store.js'
export { HubSync } from './sync.js'
export { createCollabSession } from './collab.js'
export type {
  MemoryLayer,
  MemoryCategory,
  LegacyMemoryScope,
  MemoryEntry,        // alias for LegacyMemoryEntry
  LegacyMemoryEntry,
  CollabSession,
  CollabSessionState,
  CollabEndMode,
  TeachEndMode,
  CollabIntent,
  RecallOptions,
  NodeRef,
} from './types.js'
