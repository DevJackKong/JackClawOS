/**
 * JackClaw Hub - Unified Offline Queue (WAL-based)
 *
 * Persists queued messages for offline handles.
 * Keyed by target @handle (not nodeId) so messages survive node ID changes.
 *
 * Storage strategy:
 *   - Write-Ahead Log (WAL): appendFileSync for every enqueue/dequeue op
 *   - Periodic compaction: rebuild full state file from WAL
 *   - Atomic rename on compaction: crash-safe
 *
 * Each enqueued item is a { event, data } envelope ready to be sent over WS.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'

const HUB_DIR    = path.join(os.homedir(), '.jackclaw', 'hub')
const QUEUE_FILE = path.join(HUB_DIR, 'offline-queue.json')
const WAL_FILE   = path.join(HUB_DIR, 'offline-queue.wal')

const COMPACT_THRESHOLD = 100  // compact after this many WAL entries
const COMPACT_INTERVAL  = 5 * 60_000  // or every 5 minutes

export interface QueuedEnvelope {
  event: string
  data:  unknown
}

interface WalEntry {
  op: 'enqueue' | 'dequeue'
  handle: string
  envelope?: QueuedEnvelope  // present for enqueue
  ts: number
}

class OfflineQueue {
  private queue: Record<string, QueuedEnvelope[]>
  private walCount = 0
  private compactTimer: NodeJS.Timeout | null = null

  constructor() {
    fs.mkdirSync(HUB_DIR, { recursive: true })
    // 1. Load base snapshot
    this.queue = this._loadSnapshot()
    // 2. Replay WAL on top
    this._replayWal()
    // 3. Start periodic compaction
    this.compactTimer = setInterval(() => this._compact(), COMPACT_INTERVAL)
    this.compactTimer.unref()
  }

  /** Add a message to the offline queue for a target handle. */
  enqueue(targetHandle: string, message: QueuedEnvelope): void {
    const key = this._key(targetHandle)
    const q   = this.queue[key] ?? []
    q.push(message)
    this.queue[key] = q
    this._appendWal({ op: 'enqueue', handle: key, envelope: message, ts: Date.now() })
  }

  /** Drain (remove and return) all queued messages for a handle. */
  dequeue(targetHandle: string): QueuedEnvelope[] {
    const key  = this._key(targetHandle)
    const msgs = this.queue[key] ?? []
    if (msgs.length > 0) {
      delete this.queue[key]
      this._appendWal({ op: 'dequeue', handle: key, ts: Date.now() })
    }
    return msgs
  }

  /** Count pending messages without consuming them. */
  peek(targetHandle: string): number {
    return (this.queue[this._key(targetHandle)] ?? []).length
  }

  /** Total queued messages across all handles. */
  totalPending(): number {
    return Object.values(this.queue).reduce((sum, q) => sum + q.length, 0)
  }

  private _key(handle: string): string {
    return handle.startsWith('@') ? handle : `@${handle}`
  }

  // ─── WAL operations ──────────────────────────────────────────────────────────

  private _appendWal(entry: WalEntry): void {
    try {
      fs.appendFileSync(WAL_FILE, JSON.stringify(entry) + '\n')
      this.walCount++
      if (this.walCount >= COMPACT_THRESHOLD) {
        this._compact()
      }
    } catch (e) {
      console.error('[offline-queue] WAL append failed:', e)
      // Fallback: write full snapshot
      this._writeSnapshot()
    }
  }

  private _replayWal(): void {
    if (!fs.existsSync(WAL_FILE)) return
    try {
      const data = fs.readFileSync(WAL_FILE, 'utf-8')
      const lines = data.trim().split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as WalEntry
          if (entry.op === 'enqueue' && entry.envelope) {
            const q = this.queue[entry.handle] ?? []
            q.push(entry.envelope)
            this.queue[entry.handle] = q
          } else if (entry.op === 'dequeue') {
            delete this.queue[entry.handle]
          }
        } catch { /* skip corrupt line */ }
      }
      this.walCount = lines.length
    } catch { /* WAL unreadable, state is snapshot-only */ }
  }

  // ─── Compaction ───────────────────────────────────────────────────────────────

  private _compact(): void {
    if (this.walCount === 0) return
    try {
      this._writeSnapshot()
      // Truncate WAL after successful snapshot
      fs.writeFileSync(WAL_FILE, '')
      this.walCount = 0
    } catch (e) {
      console.error('[offline-queue] Compaction failed:', e)
    }
  }

  private _writeSnapshot(): void {
    const tmpFile = QUEUE_FILE + '.tmp'
    fs.writeFileSync(tmpFile, JSON.stringify(this.queue, null, 2), 'utf-8')
    fs.renameSync(tmpFile, QUEUE_FILE)  // atomic rename
  }

  private _loadSnapshot(): Record<string, QueuedEnvelope[]> {
    try {
      if (fs.existsSync(QUEUE_FILE)) {
        return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8')) as Record<string, QueuedEnvelope[]>
      }
    } catch { /* start empty */ }
    return {}
  }
}

export const offlineQueue = new OfflineQueue()
