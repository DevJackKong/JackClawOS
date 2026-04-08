#!/usr/bin/env node
/**
 * inbox-realtime.js — 实时监听 JackClaw inbox，通过 OpenClaw gateway 推送飞书
 * 
 * Usage: nohup node scripts/inbox-realtime.js &
 */
const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')

const INBOX = path.join(process.env.HOME, '.jackclaw/hub/messages.jsonl')
const WATCH = '@jack.jackclaw'
const GW_URL = 'ws://127.0.0.1:18789'
const GW_TOKEN = '41f0696f0066507a3550b1be0397b97d2f7a39d079fd5776'

let lastLineCount = 0
let ws = null

function getLines() {
  try {
    return fs.readFileSync(INBOX, 'utf8').trim().split('\n').filter(Boolean)
  } catch { return [] }
}

function connectGateway() {
  ws = new WebSocket(GW_URL, { headers: { Authorization: `Bearer ${GW_TOKEN}` } })
  ws.on('open', () => console.log('[inbox-realtime] Connected to gateway'))
  ws.on('close', () => { console.log('[inbox-realtime] Gateway disconnected, reconnecting...'); setTimeout(connectGateway, 5000) })
  ws.on('error', (e) => console.error('[inbox-realtime] WS error:', e.message))
}

function sendToFeishu(text) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.log('[inbox-realtime] Gateway not connected, skipping:', text.slice(0, 80))
    return
  }
  // Send via gateway message action
  const payload = JSON.stringify({
    type: 'message',
    action: 'send',
    data: { message: text }
  })
  ws.send(payload)
  console.log('[inbox-realtime] Sent to feishu:', text.slice(0, 80))
}

function checkInbox() {
  const lines = getLines()
  if (lines.length > lastLineCount) {
    const newLines = lines.slice(lastLineCount)
    for (const line of newLines) {
      try {
        const m = JSON.parse(line)
        const to = m.toAgent || m.recipient || ''
        const fr = m.fromAgent || m.sender || '?'
        const ct = String(m.content || '')
        if (to === WATCH && fr !== WATCH) {
          sendToFeishu(`📨 JackClaw 新消息\n来自: ${fr}\n内容: ${ct}`)
        }
      } catch {}
    }
    lastLineCount = lines.length
  }
}

// Init
lastLineCount = getLines().length
console.log(`[inbox-realtime] Starting from line ${lastLineCount}`)
console.log(`[inbox-realtime] Watching: ${INBOX}`)

// Watch file changes
fs.watchFile(INBOX, { interval: 2000 }, () => checkInbox())

// Also poll every 5s as backup
setInterval(checkInbox, 5000)

// Connect gateway
connectGateway()

console.log('[inbox-realtime] Running...')
