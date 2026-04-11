import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryCompactor } from '../src/compactor.ts'
import type { MemoryEntry } from '../src/types.ts'

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  const now = Date.now()
  return {
    id: overrides.id ?? `id-${Math.random().toString(36).slice(2, 8)}`,
    agentId: overrides.agentId ?? 'agent-1',
    layer: overrides.layer ?? 'L2',
    category: overrides.category ?? 'user',
    scope: overrides.scope ?? 'private',
    content: overrides.content ?? 'Jack prefers concise replies and direct answers.',
    tags: overrides.tags ?? ['pref'],
    importance: overrides.importance ?? 0.8,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    expiresAt: overrides.expiresAt,
    source: overrides.source,
  }
}

describe('MemoryCompactor', () => {
  const compactor = new MemoryCompactor()

  it('deduplicates highly similar entries', () => {
    const entries = [
      makeEntry({ id: 'a', content: 'Jack prefers concise replies direct answers minimal filler words', tags: ['style'], importance: 0.7 }),
      makeEntry({ id: 'b', content: 'Jack prefers concise replies direct answers minimal filler words', tags: ['voice'], importance: 0.9 }),
      makeEntry({ id: 'c', content: 'Separate memory about project roadmap', category: 'project' }),
    ]

    const result = compactor.deduplicate(entries)
    assert.equal(result.length, 2)
    const merged = result.find(entry => entry.category === 'user')
    assert.ok(merged)
    assert.equal(merged!.importance, 0.9)
    assert.deepEqual(new Set(merged!.tags), new Set(['style', 'voice']))
  })

  it('compresses stale entries into shorter summaries', () => {
    const staleTime = Date.now() - 40 * 24 * 60 * 60 * 1000
    const longContent = 'This is a very long stale memory. It contains several details about an old context. It should be summarized and retain only the key point for later recall.'
    const [compressed] = compactor.compressStale([
      makeEntry({ id: 'stale', content: longContent, updatedAt: staleTime, createdAt: staleTime }),
    ])

    assert.ok(compressed.content.length < longContent.length)
    assert.ok(compressed.tags.includes('compressed'))
  })

  it('prunes low score entries', () => {
    const entries = [
      makeEntry({ id: 'keep', importance: 0.9 }),
      makeEntry({ id: 'drop', importance: 0.1 }),
    ]

    const result = compactor.prune(entries, 0.3)
    assert.equal(result.kept.length, 1)
    assert.equal(result.removed.length, 1)
    assert.match(result.reason[0]!, /drop: score 0.10 < 0.30/)
  })

  it('runs full compaction pipeline', () => {
    const staleTime = Date.now() - 45 * 24 * 60 * 60 * 1000
    const entries = [
      makeEntry({ id: 'a', content: 'Jack prefers concise replies direct answers minimal filler words', importance: 0.8 }),
      makeEntry({ id: 'b', content: 'Jack prefers concise replies direct answers minimal filler words', importance: 0.9 }),
      makeEntry({ id: 'c', content: 'Old stale memory that is far too verbose and contains unnecessary detail for later retrieval. It has multiple sentences with context that is no longer important. It should be shortened after compression and keep only the key point.', updatedAt: staleTime, createdAt: staleTime, importance: 0.5 }),
      makeEntry({ id: 'd', content: 'Low value reference', importance: 0.1, category: 'reference' }),
    ]

    const result = compactor.compact(entries)
    assert.equal(result.before, 4)
    assert.equal(result.after, 2)
    assert.equal(result.merged, 1)
    assert.equal(result.removed, 1)
    assert.equal(result.compressed, 1)
    assert.ok(result.log.some(line => line.includes('deduplicate: merged 1')))
  })
})
