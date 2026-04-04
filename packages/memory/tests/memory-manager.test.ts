import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryManager } from '../src/manager'
import fs from 'fs'
import path from 'path'
import os from 'os'

const NODE_ID = `test-node-${Date.now()}`
const MEMORY_ROOT = path.join(os.homedir(), '.jackclaw', 'memory', NODE_ID)

function cleanup() {
  try { fs.rmSync(MEMORY_ROOT, { recursive: true, force: true }) } catch {}
}

describe('MemoryManager', () => {
  let mm: MemoryManager

  beforeEach(() => {
    cleanup()
    mm = new MemoryManager()
  })

  afterEach(() => cleanup())

  it('saves and queries a memory entry', () => {
    const entry = mm.save({
      type: 'user',
      nodeId: NODE_ID,
      scope: 'private',
      content: 'Jack prefers concise replies',
    })
    assert.ok(entry.id)
    assert.equal(entry.type, 'user')
    assert.equal(entry.content, 'Jack prefers concise replies')

    const all = mm.query(NODE_ID, { type: 'user' })
    assert.ok(all.length >= 1)
    assert.equal(all[0].content, 'Jack prefers concise replies')
  })

  it('saves feedback with why and howToApply', () => {
    const entry = mm.save({
      type: 'feedback',
      nodeId: NODE_ID,
      scope: 'private',
      content: 'No filler words',
      why: 'Jack explicitly requested it',
      howToApply: 'Apply to all replies',
    })
    assert.equal(entry.type, 'feedback')
    assert.equal(entry.why, 'Jack explicitly requested it')
    assert.equal(entry.howToApply, 'Apply to all replies')
  })

  it('rejects feedback without why', () => {
    assert.throws(() => {
      mm.save({
        type: 'feedback',
        nodeId: NODE_ID,
        scope: 'private',
        content: 'bad feedback',
      })
    }, /why/)
  })

  it('queries by type', () => {
    mm.save({ type: 'user', nodeId: NODE_ID, scope: 'private', content: 'user info' })
    mm.save({ type: 'project', nodeId: NODE_ID, scope: 'private', content: 'project info' })
    mm.save({ type: 'project', nodeId: NODE_ID, scope: 'private', content: 'another project' })

    const projects = mm.query(NODE_ID, { type: 'project' })
    assert.equal(projects.length, 2)

    const users = mm.query(NODE_ID, { type: 'user' })
    assert.equal(users.length, 1)
  })

  it('queries by tags', () => {
    mm.save({ type: 'reference', nodeId: NODE_ID, scope: 'private', content: 'API docs', tags: ['api', 'docs'] })
    mm.save({ type: 'reference', nodeId: NODE_ID, scope: 'private', content: 'Git workflow', tags: ['git'] })

    const apiEntries = mm.query(NODE_ID, { tags: ['api'] })
    assert.equal(apiEntries.length, 1)
    assert.equal(apiEntries[0].content, 'API docs')
  })

  it('respects limit', () => {
    for (let i = 0; i < 10; i++) {
      mm.save({ type: 'project', nodeId: NODE_ID, scope: 'private', content: `Entry ${i}` })
    }
    const limited = mm.query(NODE_ID, { type: 'project', limit: 3 })
    assert.equal(limited.length, 3)
  })

  it('returns stats', () => {
    mm.save({ type: 'user', nodeId: NODE_ID, scope: 'private', content: 'test' })
    mm.save({ type: 'project', nodeId: NODE_ID, scope: 'private', content: 'test2' })

    const stats = mm.stats(NODE_ID)
    assert.equal(stats.totalEntries, 2)
    assert.equal(stats.byType.user, 1)
    assert.equal(stats.byType.project, 1)
    assert.ok(stats.totalChars > 0)
  })

  it('deletes an entry', () => {
    const entry = mm.save({ type: 'reference', nodeId: NODE_ID, scope: 'private', content: 'to delete' })
    mm.deleteFromNode(NODE_ID, entry.id)
    const remaining = mm.query(NODE_ID, { type: 'reference' })
    assert.equal(remaining.length, 0)
  })

  it('handles shared scope', () => {
    mm.save({ type: 'project', nodeId: NODE_ID, scope: 'shared', content: 'shared context' })
    const shared = mm.query(NODE_ID, { scope: 'shared' })
    assert.equal(shared.length, 1)
    assert.equal(shared[0].scope, 'shared')
  })

  it('auto-compresses when exceeding limits', () => {
    // Write many entries to trigger compression
    for (let i = 0; i < 210; i++) {
      mm.save({ type: 'reference', nodeId: NODE_ID, scope: 'private', content: `Entry ${i} with some content` })
    }
    const stats = mm.stats(NODE_ID)
    // Should have been compressed below MAX_ENTRIES
    assert.ok(stats.totalEntries <= 200, `Expected <=200, got ${stats.totalEntries}`)
  })
})
