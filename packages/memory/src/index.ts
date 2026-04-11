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

// ── 事件触发检索（L03） ──────────────────────────────────────
export { EventRetriever } from './event-retriever.js'
export type { TriggerType, TriggerEvent } from './event-retriever.js'

// ── 记忆评分（L04） ──────────────────────────────────────────
export { MemoryScorer } from './scorer.js'
export type { MemoryScore } from './scorer.js'

// ── 记忆压缩（L05） ──────────────────────────────────────────
export { MemoryCompactor } from './compactor.js'
export type { CompactionResult } from './compactor.js'

// ── 反思模块（L06/L07） ──────────────────────────────────────
export { TaskReflectionExtractor } from './reflection/task-reflection.js'
export { extractReflection, writeReflection } from './reflection/task-reflector.js'

// ── Skill 系统（L11/L12/L13/L14） ───────────────────────────
export { SkillRegistry } from './skills/registry.js'
export { SkillEvolutionDetector } from './skills/evolution-detector.js'
export { SkillVersionManager } from './skills/versioning.js'
export * from './skills/builtin/index.js'
export type { SkillMeta, SkillEntry } from './skills/registry.js'
export type { SkillCandidate, FrequencyRecord } from './skills/evolution-detector.js'
export type { SkillVersion, VersionDiff } from './skills/versioning.js'

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
