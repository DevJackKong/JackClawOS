/**
 * VaultIsolationStore — Payment Vault 隔离存储层
 *
 * 规则（同 Watchdog isolation 模式）：
 *  - 存储路径 ~/.jackclaw/vault/<nodeId>/，独立于 Watchdog/Memory
 *  - payments.jsonl chmod 444，只追加不可修改
 *  - 本模块不暴露删除/覆盖接口
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { PaymentRequest } from '@jackclaw/protocol'

const VAULT_BASE_DEFAULT = path.join(os.homedir(), '.jackclaw', 'vault')

function nodeDir(baseDir: string, nodeId: string): string {
  return path.join(baseDir, nodeId)
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

// ── Append-only payment log ──────────────────────────────────────────────────

export function appendPaymentLog(
  baseDir: string,
  nodeId: string,
  entry: PaymentRequest,
): void {
  const dir = nodeDir(baseDir, nodeId)
  ensureDir(dir)
  const filePath = path.join(dir, 'payments.jsonl')

  // Temporarily unlock if exists
  if (fs.existsSync(filePath)) {
    try { fs.chmodSync(filePath, 0o644) } catch { /* ignore */ }
  }

  fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8')
  fs.chmodSync(filePath, 0o444)
}

export function readPaymentLog(
  baseDir: string,
  nodeId: string,
): PaymentRequest[] {
  const filePath = path.join(nodeDir(baseDir, nodeId), 'payments.jsonl')
  if (!fs.existsSync(filePath)) return []

  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean)
  return lines.map(line => JSON.parse(line) as PaymentRequest)
}

// ── Daily totals (computed from log) ─────────────────────────────────────────

export function computeDailyTotal(
  baseDir: string,
  nodeId: string,
): number {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayMs = todayStart.getTime()

  const entries = readPaymentLog(baseDir, nodeId)
  return entries
    .filter(e =>
      e.createdAt >= todayMs &&
      (e.status === 'executed' || e.status === 'approved' || e.status === 'pending_human' || e.status === 'pending_compliance')
    )
    .reduce((sum, e) => sum + e.amount, 0)
}

export { VAULT_BASE_DEFAULT }
