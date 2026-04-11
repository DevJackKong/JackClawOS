// JackClaw Agent Memory — 统一记忆 Schema

/** 记忆类型：描述事实、偏好、失败、成功模式与 SOP */
export type MemoryType = 'fact' | 'preference' | 'failure' | 'success_pattern' | 'sop'

/** 记忆分层：工作态、经历态、用户态、程序态 */
export type MemoryLayer = 'working' | 'episodic' | 'user' | 'procedural'

/** 记忆元信息：用于检索、置信度评估与新鲜度判断 */
export interface MemoryMetadata {
  source?: string
  confidence?: number
  hitCount?: number
  successRate?: number
  lastVerified?: number
  isStale?: boolean
  tags?: string[]
}

/** 统一记忆基础结构 */
export interface MemoryEntry {
  id: string
  type: MemoryType
  layer: MemoryLayer
  content: string
  metadata: MemoryMetadata
}

/** 失败记忆：沉淀错误、修复方式与可复用规则 */
export interface FailureMemory extends MemoryEntry {
  type: 'failure'
  errorType: string
  context: string
  fix: string
  reusableRule?: string
}

/** 成功模式：抽象可重复复用的成功经验 */
export interface SuccessPattern extends MemoryEntry {
  type: 'success_pattern'
  trigger: string
  strategy: string
  outcome: string
  repeatCount: number
}

/** 任务复盘：描述结果、原因、修复与规则提炼 */
export interface TaskReflection {
  result: string
  cause: string
  fix: string
  reusableRule?: string
  confidence: number
}
