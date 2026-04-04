/**
 * LogWriter — 进程日志写入器
 *
 * 写入路径：~/.jackclaw/logs/{service}.log
 * 按天轮转：每日零点将旧日志重命名为 {service}.YYYY-MM-DD.log
 * 保留 7 天，超出自动删除
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const LOG_DIR = path.join(os.homedir(), '.jackclaw', 'logs')
const KEEP_DAYS = 7

export class LogWriter {
  private currentDay: string
  readonly logPath: string

  constructor(readonly service: 'hub' | 'node') {
    fs.mkdirSync(LOG_DIR, { recursive: true })
    this.logPath = path.join(LOG_DIR, `${service}.log`)
    this.currentDay = this.today()
  }

  write(line: string): void {
    const day = this.today()
    if (day !== this.currentDay) {
      this.rotate()
      this.currentDay = day
    }
    try {
      fs.appendFileSync(this.logPath, line + '\n', 'utf8')
    } catch { /* ignore write errors — never crash the main process */ }
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  }

  private rotate(): void {
    if (fs.existsSync(this.logPath)) {
      const dated = path.join(LOG_DIR, `${this.service}.${this.currentDay}.log`)
      try { fs.renameSync(this.logPath, dated) } catch { /* ignore */ }
    }
    this.pruneOldLogs()
  }

  private pruneOldLogs(): void {
    const cutoffMs = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000
    try {
      const files = fs.readdirSync(LOG_DIR)
      for (const f of files) {
        const match = f.match(/^(hub|node)\.\d{4}-\d{2}-\d{2}\.log$/)
        if (match && match[1] === this.service) {
          const fp = path.join(LOG_DIR, f)
          const stat = fs.statSync(fp)
          if (stat.mtimeMs < cutoffMs) fs.unlinkSync(fp)
        }
      }
    } catch { /* ignore */ }
  }
}

/**
 * 读取日志文件最后 N 行（tail -n 模拟）
 */
export function tailLog(service: 'hub' | 'node', lines: number): string[] {
  const logPath = path.join(LOG_DIR, `${service}.log`)
  if (!fs.existsSync(logPath)) return []

  const content = fs.readFileSync(logPath, 'utf8')
  const all = content.split('\n').filter(l => l.length > 0)
  return all.slice(-lines)
}
