// L2 个人记忆 — SQLite 持久化存储

import Database from 'better-sqlite3'
import path from 'path'
import os from 'os'
import type { MemoryEntry, RecallOptions } from './types.js'

const DEFAULT_DB_PATH = path.join(os.homedir(), '.jackclaw', 'memory.db')

export class L2Store {
  private db: Database.Database

  constructor(dbPath = DEFAULT_DB_PATH) {
    const dir = path.dirname(dbPath)
    import('fs').then(fs => fs.mkdirSync(dir, { recursive: true })).catch(() => {})
    // sync mkdir
    const fs = require('fs')
    fs.mkdirSync(dir, { recursive: true })

    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.init()
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        agentId TEXT NOT NULL,
        layer TEXT NOT NULL DEFAULT 'L2',
        category TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'private',
        content TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        importance REAL NOT NULL DEFAULT 0.5,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        expiresAt INTEGER,
        source TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_agent ON memories(agentId);
      CREATE INDEX IF NOT EXISTS idx_category ON memories(category);
      CREATE INDEX IF NOT EXISTS idx_scope ON memories(scope);
      CREATE INDEX IF NOT EXISTS idx_importance ON memories(importance DESC);
    `)
  }

  save(entry: MemoryEntry): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO memories
        (id, agentId, layer, category, scope, content, tags, importance, createdAt, updatedAt, expiresAt, source)
      VALUES
        (@id, @agentId, @layer, @category, @scope, @content, @tags, @importance, @createdAt, @updatedAt, @expiresAt, @source)
    `)
    stmt.run({
      ...entry,
      tags: JSON.stringify(entry.tags),
      expiresAt: entry.expiresAt ?? null,
      source: entry.source ?? null,
    })
  }

  get(id: string): MemoryEntry | undefined {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? this.rowToEntry(row) : undefined
  }

  query(agentId: string, opts: RecallOptions = {}): MemoryEntry[] {
    const conditions: string[] = ['agentId = ?']
    const params: unknown[] = [agentId]

    if (opts.layer) { conditions.push('layer = ?'); params.push(opts.layer) }
    if (opts.category) { conditions.push('category = ?'); params.push(opts.category) }
    if (opts.scope) { conditions.push('scope = ?'); params.push(opts.scope) }
    if (opts.minImportance !== undefined) { conditions.push('importance >= ?'); params.push(opts.minImportance) }

    const where = conditions.join(' AND ')
    const limit = opts.limit ?? 100
    const rows = this.db.prepare(
      `SELECT * FROM memories WHERE ${where} ORDER BY importance DESC, updatedAt DESC LIMIT ?`
    ).all([...params, limit]) as Record<string, unknown>[]

    let entries = rows.map(r => this.rowToEntry(r))

    if (opts.tags?.length) {
      entries = entries.filter(e => opts.tags!.some(t => e.tags.includes(t)))
    }

    return entries
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(id)
  }

  all(agentId: string): MemoryEntry[] {
    const rows = this.db.prepare('SELECT * FROM memories WHERE agentId = ?').all(agentId) as Record<string, unknown>[]
    return rows.map(r => this.rowToEntry(r))
  }

  private rowToEntry(row: Record<string, unknown>): MemoryEntry {
    return {
      id: row['id'] as string,
      agentId: row['agentId'] as string,
      layer: row['layer'] as MemoryEntry['layer'],
      category: row['category'] as MemoryEntry['category'],
      scope: row['scope'] as MemoryEntry['scope'],
      content: row['content'] as string,
      tags: JSON.parse(row['tags'] as string) as string[],
      importance: row['importance'] as number,
      createdAt: row['createdAt'] as number,
      updatedAt: row['updatedAt'] as number,
      expiresAt: row['expiresAt'] as number | undefined,
      source: row['source'] as string | undefined,
    }
  }
}
