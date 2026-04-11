// JackClaw Agent Memory — Schema Validators

import type { FailureMemory, MemoryEntry, SuccessPattern } from './schema.js'

const MEMORY_TYPES = new Set(['fact', 'preference', 'failure', 'success_pattern', 'sop'])
const MEMORY_LAYERS = new Set(['working', 'episodic', 'user', 'procedural'])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

/** 校验并标准化统一记忆条目，不合法时直接抛错 */
export function validateMemoryEntry(entry: unknown): MemoryEntry {
  if (!isObject(entry)) throw new Error('MemoryEntry 必须是对象')

  const { id, type, layer, content, metadata } = entry

  if (typeof id !== 'string' || !id.trim()) throw new Error('MemoryEntry.id 非法')
  if (typeof type !== 'string' || !MEMORY_TYPES.has(type)) throw new Error('MemoryEntry.type 非法')
  if (typeof layer !== 'string' || !MEMORY_LAYERS.has(layer)) throw new Error('MemoryEntry.layer 非法')
  if (typeof content !== 'string') throw new Error('MemoryEntry.content 非法')
  if (!isObject(metadata)) throw new Error('MemoryEntry.metadata 非法')

  const normalizedMetadata = {
    source: typeof metadata.source === 'string' ? metadata.source : undefined,
    confidence: typeof metadata.confidence === 'number' ? metadata.confidence : undefined,
    hitCount: typeof metadata.hitCount === 'number' ? metadata.hitCount : undefined,
    successRate: typeof metadata.successRate === 'number' ? metadata.successRate : undefined,
    lastVerified: typeof metadata.lastVerified === 'number' ? metadata.lastVerified : undefined,
    isStale: typeof metadata.isStale === 'boolean' ? metadata.isStale : undefined,
    tags: isStringArray(metadata.tags) ? metadata.tags : undefined,
  }

  return {
    id,
    type,
    layer,
    content,
    metadata: normalizedMetadata,
  }
}

/** 判断是否为失败记忆 */
export function isFailureMemory(entry: unknown): entry is FailureMemory {
  return (
    isObject(entry) &&
    entry.type === 'failure' &&
    typeof entry.errorType === 'string' &&
    typeof entry.context === 'string' &&
    typeof entry.fix === 'string' &&
    (entry.reusableRule === undefined || typeof entry.reusableRule === 'string')
  )
}

/** 判断是否为成功模式记忆 */
export function isSuccessPattern(entry: unknown): entry is SuccessPattern {
  return (
    isObject(entry) &&
    entry.type === 'success_pattern' &&
    typeof entry.trigger === 'string' &&
    typeof entry.strategy === 'string' &&
    typeof entry.outcome === 'string' &&
    typeof entry.repeatCount === 'number'
  )
}
