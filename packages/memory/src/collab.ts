// 协作会话 — 零配置 P2P，支持技能转移与教学隔离

import { nanoid } from 'nanoid'
import path from 'path'
import os from 'os'
import fs from 'fs'
import type {
  CollabSession,
  CollabIntent,
  CollabEndMode,
  TeachEndMode,
  MemoryEntry,
  MemoryCategory,
  LegacyMemoryScope,
} from './types.js'
import type { L2Store } from './store.js'

const SNAPSHOTS_DIR = path.join(os.homedir(), '.jackclaw', 'snapshots')

export function createCollabSession(opts: {
  peerId: string
  agentId: string
  intent: CollabIntent
  topic?: string
  store: L2Store
  onEnd?: (entries: MemoryEntry[]) => Promise<void>
}): CollabSession {
  const sessionId = nanoid()
  const startedAt = Date.now()
  // 独立沙箱，不写 L2
  const sandbox: MemoryEntry[] = []

  const session: CollabSession = {
    id: sessionId,
    intent: opts.intent,
    initiatorId: opts.agentId,
    peerId: opts.peerId,
    topic: opts.topic,
    startedAt,

    share(content: string, tags: string[] = []): MemoryEntry {
      const entry: MemoryEntry = {
        id: nanoid(),
        agentId: opts.agentId,
        layer: 'L1',
        category: 'reference' as MemoryCategory,
        scope: `peer:${opts.peerId}` as LegacyMemoryScope,
        content,
        tags,
        importance: 0.5,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: opts.agentId,
      }
      sandbox.push(entry)
      return entry
    },

    teach(partial: Partial<MemoryEntry>): MemoryEntry {
      const entry: MemoryEntry = {
        id: nanoid(),
        agentId: opts.agentId,
        layer: 'L1',
        category: (partial.category ?? 'skill') as MemoryCategory,
        scope: (partial.scope ?? `peer:${opts.peerId}`) as LegacyMemoryScope,
        content: partial.content ?? '',
        tags: partial.tags ?? [],
        importance: partial.importance ?? 0.8,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: opts.agentId,
        ...partial,
        id: nanoid(),
      }
      sandbox.push(entry)
      return entry
    },

    async end(mode: CollabEndMode | TeachEndMode): Promise<void> {
      // 通知 Hub 结束（如有）
      if (opts.onEnd) {
        await opts.onEnd(sandbox).catch(err =>
          console.error('[collab] onEnd failed:', err)
        )
      }

      switch (mode) {
        case 'discard':
          // 沙箱完全清空，L2 不变
          sandbox.length = 0
          break

        case 'archive': {
          // 沙箱内容写入学习者 L2，source 保留
          const now = Date.now()
          for (const entry of sandbox) {
            opts.store.save({
              ...entry,
              layer: 'L2',
              scope: 'private',
              agentId: opts.agentId,
              updatedAt: now,
            })
          }
          sandbox.length = 0
          break
        }

        case 'snapshot': {
          // 序列化为独立 JSON，不合并主记忆，随时可删/激活
          fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true })
          const snapshotPath = path.join(SNAPSHOTS_DIR, `teaching-${sessionId}.json`)
          fs.writeFileSync(
            snapshotPath,
            JSON.stringify(
              {
                sessionId,
                intent: opts.intent,
                peerId: opts.peerId,
                topic: opts.topic,
                savedAt: Date.now(),
                entries: sandbox,
              },
              null,
              2
            )
          )
          console.log(`[collab] Snapshot saved: ${snapshotPath}`)
          sandbox.length = 0
          break
        }

        case 'publish':
          // publish 由 MemoryManager 处理（推送 L3），这里只清沙箱
          sandbox.length = 0
          break
      }
    },
  }

  return session
}
