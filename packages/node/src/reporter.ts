import fs from 'fs'
import path from 'path'
import type { JackClawConfig } from './config'
import type { ReportPayload } from '@jackclaw/protocol'

/**
 * Read today's memory file from the OpenClaw workspace.
 * Applies redact patterns before returning.
 */
export function readTodayMemory(config: JackClawConfig): string | null {
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const memFile = path.join(config.workspaceDir, 'memory', `${today}.md`)

  if (!fs.existsSync(memFile)) {
    return null
  }

  let content = fs.readFileSync(memFile, 'utf8')

  // Apply redact patterns
  for (const pattern of config.visibility.redactPatterns) {
    try {
      const re = new RegExp(pattern, 'gi')
      content = content.replace(re, '[REDACTED]')
    } catch {
      console.warn(`[reporter] Invalid redact pattern: ${pattern}`)
    }
  }

  return content
}

/**
 * Generate a daily report payload.
 * Respects visibility settings.
 */
export function buildDailyReport(config: JackClawConfig): ReportPayload {
  if (!config.visibility.shareMemory) {
    return {
      summary: 'Memory sharing disabled by node config',
      period: 'daily',
      visibility: 'private',
      data: {},
    }
  }

  const memContent = readTodayMemory(config)

  if (!memContent) {
    return {
      summary: 'No memory file for today',
      period: 'daily',
      visibility: 'summary_only',
      data: { date: new Date().toISOString().slice(0, 10) },
    }
  }

  // Build a lightweight summary (first 500 chars + line count)
  const lines = memContent.split('\n')
  const preview = memContent.slice(0, 500)
  const summary = `${lines.length} lines recorded today. Preview: ${preview}...`

  return {
    summary,
    period: 'daily',
    visibility: 'full',
    data: {
      date: new Date().toISOString().slice(0, 10),
      lineCount: lines.length,
      charCount: memContent.length,
      // Only send full content if visibility is 'full'
      content: memContent,
    },
  }
}
