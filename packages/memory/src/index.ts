// @jackclaw/memory — 公开 API

// ── 新4分类记忆体系 ──────────────────────────────────────────
export { MemoryManager } from './manager.js'
export * from './layers/index.js'
export type {
  MemDir,
  MemoryType as MemDirMemoryType,
  MemoryScope,
  MemoryStats,
  MemDirQueryOptions,
} from './types.js'

// ── 统一记忆 Schema（L02） ───────────────────────────────────
export type {
  MemoryEntry as UnifiedMemoryEntry,
  MemoryType,
  MemoryLayer,
  MemoryMetadata,
  FailureMemory,
  SuccessPattern,
  TaskReflection,
} from './schema.js'
export {
  validateMemoryEntry,
  isFailureMemory,
  isSuccessPattern,
} from './validators.js'

// ── 旧三层架构（保留向后兼容） ────────────────────────────────
export { L1Cache } from './l1-cache.js'
export { L2Store } from './store.js'
export { HubSync, MemDirSync } from './sync.js'
export { createCollabSession } from './collab.js'
export type {
  MemoryLayer as LegacyMemoryLayer,
  MemoryCategory,
  LegacyMemoryScope,
  MemoryEntry,
  LegacyMemoryEntry,
  CollabSession,
  CollabSessionState,
  CollabEndMode,
  TeachEndMode,
  CollabIntent,
  RecallOptions,
  NodeRef,
} from './types.js'
