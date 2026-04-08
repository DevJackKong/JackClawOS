#!/usr/bin/env ts-node
/**
 * inbox-watcher.ts — 监听 JackClaw Hub inbox，新消息自动转发飞书
 *
 * Usage: npx ts-node scripts/inbox-watcher.ts
 * 或:    nohup npx ts-node scripts/inbox-watcher.ts &
 */

import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import * as http from 'http'

// ─── Config ───
const INBOX_FILE = path.join(process.env.HOME || '~', '.jackclaw/hub/messages.jsonl')
const WATCH_AGENT = '@jack.jackclaw'
const POLL_INTERVAL = 5000 // 5 seconds
const FEISHU_WEBHOOK = process.env.FEISHU_WEBHOOK || '' // 飞书 webhook URL (optional)
const HUB_URL = process.env.HUB_URL || 'http://localhost:3100'

let lastLineCount = 0

function getLineCount(filePath: string): number {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return content.trim().split('\n').filter(Boolean).length
  } catch {
    return 0
  }
}

function getNewLines(filePath: string, fromLine: number): string[] {
  try {
    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean)
    return lines.slice(fromLine)
  } catch {
    return []
  }
}

interface InboxMessage {
  fromAgent?: string
  toAgent?: string
  sender?: string
  recipient?: string
  content?: string
  ts?: number
}

function parseMessage(line: string): InboxMessage | null {
  try {
    return JSON.parse(line) as InboxMessage
  } catch {
    return null
  }
}

function sendFeishuNotification(from: string, content: string): void {
  // Method 1: Feishu webhook (if configured)
  if (FEISHU_WEBHOOK) {
    const payload = JSON.stringify({
      msg_type: 'text',
      content: {
        text: `📨 JackClaw 新消息\n\n来自: ${from}\n内容: ${content}`
      }
    })

    const url = new URL(FEISHU_WEBHOOK)
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }

    const req = (url.protocol === 'https:' ? https : http).request(options, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        console.log(`[feishu] Notification sent (${res.statusCode}): ${body.slice(0, 100)}`)
      })
    })
    req.on('error', (e) => console.error(`[feishu] Error: ${e.message}`))
    req.write(payload)
    req.end()
    return
  }

  // Method 2: Use openclaw CLI to send via feishu bridge
  const { execSync } = require('child_process')
  try {
    execSync(
      `openclaw send "📨 JackClaw 新消息\n来自: ${from}\n内容: ${content.replace(/"/g, '\\"')}"`,
      { timeout: 10000, stdio: 'pipe' }
    )
    console.log(`[openclaw] Notification sent`)
  } catch {
    // Method 3: Just log it — the parent process (openclaw) will pick it up
    console.log(`[inbox-watcher] 📨 NEW MESSAGE for you:`)
    console.log(`  From: ${from}`)
    console.log(`  Content: ${content}`)
  }
}

function poll(): void {
  const currentCount = getLineCount(INBOX_FILE)

  if (currentCount > lastLineCount) {
    const newLines = getNewLines(INBOX_FILE, lastLineCount)

    for (const line of newLines) {
      const msg = parseMessage(line)
      if (!msg) continue

      const to = msg.toAgent || msg.recipient || ''
      const from = msg.fromAgent || msg.sender || '?'
      const content = String(msg.content || '')

      // Only notify for messages TO our agent, not FROM our agent
      if (to === WATCH_AGENT && from !== WATCH_AGENT) {
        console.log(`[inbox-watcher] ${from} → ${to}: ${content.slice(0, 80)}`)
        sendFeishuNotification(from, content)
      }
    }

    lastLineCount = currentCount
  }
}

// ─── Main ───
console.log(`[inbox-watcher] Starting...`)
console.log(`[inbox-watcher] Watching: ${INBOX_FILE}`)
console.log(`[inbox-watcher] Agent: ${WATCH_AGENT}`)
console.log(`[inbox-watcher] Poll: ${POLL_INTERVAL}ms`)
console.log(`[inbox-watcher] Feishu webhook: ${FEISHU_WEBHOOK ? 'configured' : 'not set (will use openclaw CLI)'}`)

// Start from current position (don't replay old messages)
lastLineCount = getLineCount(INBOX_FILE)
console.log(`[inbox-watcher] Starting from line ${lastLineCount}`)

setInterval(poll, POLL_INTERVAL)
console.log(`[inbox-watcher] Running. Press Ctrl+C to stop.`)
