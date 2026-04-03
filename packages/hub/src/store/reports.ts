// JackClaw Hub - Report Store
// Persists to ~/.jackclaw/hub/reports/[nodeId]/[date].json

import fs from 'fs'
import path from 'path'
import { ReportEntry, DailyReports } from '../types'

const REPORTS_BASE = path.join(process.env.HOME || '~', '.jackclaw', 'hub', 'reports')

function getReportPath(nodeId: string, date: string): string {
  return path.join(REPORTS_BASE, nodeId, `${date}.json`)
}

function ensureDir(nodeId: string): void {
  fs.mkdirSync(path.join(REPORTS_BASE, nodeId), { recursive: true })
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

export function saveReport(entry: ReportEntry): void {
  const date = new Date(entry.timestamp).toISOString().slice(0, 10)
  ensureDir(entry.nodeId)
  const filePath = getReportPath(entry.nodeId, date)

  let daily: DailyReports
  if (fs.existsSync(filePath)) {
    try {
      daily = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as DailyReports
    } catch {
      daily = { date, nodeId: entry.nodeId, reports: [] }
    }
  } else {
    daily = { date, nodeId: entry.nodeId, reports: [] }
  }

  daily.reports.push(entry)
  fs.writeFileSync(filePath, JSON.stringify(daily, null, 2), 'utf-8')
}

export function getReports(nodeId: string, date?: string): DailyReports | null {
  const d = date ?? todayDate()
  const filePath = getReportPath(nodeId, d)
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as DailyReports
  } catch {
    return null
  }
}

export function getAllNodeReportsForDate(date?: string): DailyReports[] {
  const d = date ?? todayDate()
  const results: DailyReports[] = []

  if (!fs.existsSync(REPORTS_BASE)) return results

  const nodeDirs = fs.readdirSync(REPORTS_BASE, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)

  for (const nodeId of nodeDirs) {
    const filePath = getReportPath(nodeId, d)
    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as DailyReports
        results.push(data)
      } catch {
        // skip corrupt files
      }
    }
  }

  return results
}

export function getLastReportEntry(nodeId: string): ReportEntry | null {
  // Scan last 7 days for most recent report
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
    const daily = getReports(nodeId, d)
    if (daily && daily.reports.length > 0) {
      return daily.reports[daily.reports.length - 1]
    }
  }
  return null
}
