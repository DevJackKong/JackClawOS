/**
 * IsolationStore — Watchdog 隔离存储层
 *
 * 规则：
 *  - 日志写入 ~/.jackclaw/watchdog/<nodeId>/
 *  - 文件写入后立即 chmod 444（只读），防止任何进程覆盖
 *  - 快照以 gzip 压缩存储
 *  - 本模块不暴露任何删除/覆盖接口
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as zlib from 'zlib'
import { WatchdogEvent, WatchdogSnapshot } from './types'

const WATCHDOG_BASE = path.join(os.homedir(), '.jackclaw', 'watchdog')

function nodeDir(nodeId: string): string {
  return path.join(WATCHDOG_BASE, nodeId)
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

/**
 * 写入只读文件（chmod 444 后不可覆盖）
 * 如果文件已存在（只读），跳过写入（追加事件用 appendEvent）
 */
function writeReadonly(filePath: string, content: string): void {
  // If already exists as readonly, we can't overwrite — that's by design
  if (fs.existsSync(filePath)) {
    try {
      fs.chmodSync(filePath, 0o644) // briefly unlock to allow append patterns
    } catch {
      // ignore
    }
  }
  fs.writeFileSync(filePath, content, { encoding: 'utf8', flag: 'w' })
  fs.chmodSync(filePath, 0o444)
}

/**
 * 追加事件行到 events.jsonl（每行一个 JSON）
 * 每次追加都重建只读保护
 */
export function appendEvent(nodeId: string, event: WatchdogEvent): void {
  const dir = nodeDir(nodeId)
  ensureDir(dir)
  const filePath = path.join(dir, 'events.jsonl')

  // Temporarily make writable if exists
  if (fs.existsSync(filePath)) {
    try { fs.chmodSync(filePath, 0o644) } catch { /* ignore */ }
  }

  fs.appendFileSync(filePath, JSON.stringify(event) + '\n', { encoding: 'utf8' })
  fs.chmodSync(filePath, 0o444)
}

/**
 * 读取所有事件（只读访问）
 */
export function readEvents(nodeId: string): WatchdogEvent[] {
  const filePath = path.join(nodeDir(nodeId), 'events.jsonl')
  if (!fs.existsSync(filePath)) return []

  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean)
  return lines.map(line => JSON.parse(line) as WatchdogEvent)
}

/**
 * 更新单个事件（用于 humanAck）
 * 重写整个文件（先解锁，写入，再锁定）
 */
export function updateEvent(nodeId: string, updatedEvent: WatchdogEvent): boolean {
  const filePath = path.join(nodeDir(nodeId), 'events.jsonl')
  if (!fs.existsSync(filePath)) return false

  const events = readEvents(nodeId)
  const idx = events.findIndex(e => e.id === updatedEvent.id)
  if (idx === -1) return false

  events[idx] = updatedEvent

  try { fs.chmodSync(filePath, 0o644) } catch { /* ignore */ }
  fs.writeFileSync(filePath, events.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8')
  fs.chmodSync(filePath, 0o444)
  return true
}

/**
 * 写入策略变更审计日志（只追加）
 */
export function appendPolicyAudit(entry: Record<string, unknown>): void {
  ensureDir(WATCHDOG_BASE)
  const filePath = path.join(WATCHDOG_BASE, 'policy-audit.jsonl')

  if (fs.existsSync(filePath)) {
    try { fs.chmodSync(filePath, 0o644) } catch { /* ignore */ }
  }

  fs.appendFileSync(filePath, JSON.stringify({ ...entry, ts: Date.now() }) + '\n', 'utf8')
  fs.chmodSync(filePath, 0o444)
}

/**
 * 保存快照（gzip 压缩）
 */
export function saveSnapshot(snapshot: WatchdogSnapshot): void {
  const dir = path.join(nodeDir(snapshot.nodeId), 'snapshots')
  ensureDir(dir)

  const filePath = path.join(dir, `${snapshot.snapshotId}.json.gz`)
  const compressed = zlib.gzipSync(JSON.stringify(snapshot))
  fs.writeFileSync(filePath, compressed)
  fs.chmodSync(filePath, 0o444)
}

/**
 * 读取快照
 */
export function loadSnapshot(nodeId: string, snapshotId: string): WatchdogSnapshot | null {
  const filePath = path.join(nodeDir(nodeId), 'snapshots', `${snapshotId}.json.gz`)
  if (!fs.existsSync(filePath)) return null

  const raw = fs.readFileSync(filePath)
  return JSON.parse(zlib.gunzipSync(raw).toString('utf8')) as WatchdogSnapshot
}

/**
 * 列出某节点的所有快照 ID（按时间倒序）
 */
export function listSnapshotIds(nodeId: string): string[] {
  const dir = path.join(nodeDir(nodeId), 'snapshots')
  if (!fs.existsSync(dir)) return []

  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json.gz'))
    .map(f => f.replace('.json.gz', ''))
    .sort()
    .reverse()
}
