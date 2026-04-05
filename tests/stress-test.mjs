#!/usr/bin/env node
/**
 * JackClaw Hub 压力测试
 *
 * 100 并发 WebSocket 连接 × 10 条消息 = 1000 条消息总量
 * 统计：连接时间、吞吐量、丢失率、P50/P95/P99 延迟
 *
 * Usage: node tests/stress-test.mjs
 */

import http from 'http'
import { spawn } from 'child_process'
import WebSocket from 'ws'
import crypto from 'crypto'

// ─── Config ───────────────────────────────────────────────────────────────────

const HUB_PORT = 3195
const HUB_URL = `http://localhost:${HUB_PORT}`
const WS_BASE = `ws://localhost:${HUB_PORT}`

const NUM_USERS = 100
const MSGS_PER_USER = 10
const TOTAL_MSGS = NUM_USERS * MSGS_PER_USER
const TIMEOUT_MS = 30_000

// ─── State ────────────────────────────────────────────────────────────────────

let hubProcess = null
/** @type {Map<string, {ws: WebSocket, token: string}>} */
const clients = new Map()

// latency samples: ms from send→ack
const latencySamples = []
// track sent & acked message IDs
const sentAt = new Map()   // msgId → timestamp (ms)
const ackedIds = new Set()

// ─── Logging ──────────────────────────────────────────────────────────────────

function ts() { return new Date().toISOString().slice(11, 23) }
function log(tag, msg) { console.log(`[${ts()}] [${tag}] ${msg}`) }
function err(tag, msg) { console.error(`[${ts()}] [${tag}] ${msg}`) }

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function httpPost(url, body, token) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const u = new URL(url)
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    }
    if (token) headers['Authorization'] = `Bearer ${token}`
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers },
      (res) => {
        let buf = ''
        res.on('data', c => buf += c)
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(buf) }) }
          catch { resolve({ status: res.statusCode, body: buf }) }
        })
      }
    )
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    http.get({ hostname: u.hostname, port: u.port, path: u.pathname + u.search }, (res) => {
      let buf = ''
      res.on('data', c => buf += c)
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }) }
        catch { resolve({ status: res.statusCode, body: buf }) }
      })
    }).on('error', reject)
  })
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function waitForPort(port, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await httpGet(`http://localhost:${port}/health`)
      if (res.status === 200) return true
    } catch {}
    await sleep(300)
  }
  return false
}

// ─── Percentile helper ────────────────────────────────────────────────────────

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

// ─── Steps ────────────────────────────────────────────────────────────────────

async function startHub() {
  log('hub', `Starting Hub on port ${HUB_PORT}`)

  hubProcess = spawn('node', ['packages/hub/dist/index.js'], {
    cwd: process.cwd(),
    env: { ...process.env, HUB_PORT: String(HUB_PORT), NODE_ENV: 'test' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  hubProcess.stderr.on('data', d => {
    const line = d.toString().trim()
    if (line && process.env.VERBOSE) err('hub', line)
  })
  hubProcess.on('exit', code => {
    if (code !== null && code !== 0) err('hub', `Exited with code ${code}`)
  })

  const ready = await waitForPort(HUB_PORT)
  if (!ready) throw new Error('Hub did not become healthy within 12s')
  log('hub', 'Ready')
}

async function registerUsers() {
  log('register', `Registering ${NUM_USERS} users in parallel…`)

  const results = await Promise.allSettled(
    Array.from({ length: NUM_USERS }, (_, i) => {
      const nodeId = `user-${i}`
      const { publicKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 1024, // smaller key for speed
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      })
      return httpPost(`${HUB_URL}/api/register`, {
        nodeId,
        name: `Stress User ${i}`,
        role: 'agent',
        publicKey,
      }).then(res => {
        if (res.status !== 200 && res.status !== 201)
          throw new Error(`user-${i} reg failed: ${res.status}`)
        return { nodeId, token: res.body.token }
      })
    })
  )

  let ok = 0
  for (const r of results) {
    if (r.status === 'fulfilled') {
      clients.set(r.value.nodeId, { token: r.value.token, ws: null })
      ok++
    } else {
      err('register', r.reason?.message ?? r.reason)
    }
  }
  log('register', `${ok}/${NUM_USERS} registered`)
  if (ok === 0) throw new Error('All registrations failed')
}

async function connectWebSockets() {
  log('ws', `Opening ${clients.size} WebSocket connections…`)

  const connectStart = Date.now()
  const connectionTimes = []

  const tasks = Array.from(clients.entries()).map(([nodeId, info]) =>
    new Promise((resolve) => {
      const t0 = Date.now()
      const wsUrl = `${WS_BASE}/chat/ws?nodeId=${encodeURIComponent(nodeId)}`
      const ws = new WebSocket(wsUrl, {
        headers: info.token ? { Authorization: `Bearer ${info.token}` } : {},
      })

      const timer = setTimeout(() => {
        err('ws', `${nodeId} connection timeout`)
        resolve('timeout')
      }, 8000)

      ws.on('open', () => {
        clearTimeout(timer)
        connectionTimes.push(Date.now() - t0)
        info.ws = ws

        // Listen for acks and incoming messages
        ws.on('message', (raw) => {
          try {
            const data = JSON.parse(raw.toString())
            // Hub sends ack when it receives the message
            if (data.event === 'ack' && data.messageId) {
              const sent = sentAt.get(data.messageId)
              if (sent !== undefined) {
                latencySamples.push(Date.now() - sent)
                ackedIds.add(data.messageId)
              }
            }
            // Also treat receipt.accepted as ack
            if (data.event === 'receipt' && data.data?.status === 'accepted') {
              const msgId = data.data.messageId
              const sent = sentAt.get(msgId)
              if (sent !== undefined && !ackedIds.has(msgId)) {
                latencySamples.push(Date.now() - sent)
                ackedIds.add(msgId)
              }
            }
          } catch {}
        })

        resolve('ok')
      })

      ws.on('error', (e) => {
        clearTimeout(timer)
        err('ws', `${nodeId}: ${e.message}`)
        resolve('error')
      })
    })
  )

  const outcomes = await Promise.all(tasks)
  const connected = outcomes.filter(o => o === 'ok').length
  const elapsed = Date.now() - connectStart

  const sortedConn = [...connectionTimes].sort((a, b) => a - b)
  log('ws', `${connected}/${clients.size} connected in ${elapsed}ms`)
  if (connectionTimes.length > 0) {
    log('ws', `Connect times — min:${sortedConn[0]}ms  avg:${Math.round(connectionTimes.reduce((a, b) => a + b, 0) / connectionTimes.length)}ms  max:${sortedConn.at(-1)}ms`)
  }

  return { connected, connectMs: elapsed, connectionTimes: sortedConn }
}

async function sendMessages() {
  log('send', `Sending ${TOTAL_MSGS} messages (${MSGS_PER_USER} per user)…`)

  const userIds = Array.from(clients.keys())
  const sendStart = Date.now()

  // Send all messages as fast as possible
  for (let u = 0; u < userIds.length; u++) {
    const fromId = userIds[u]
    const toId = userIds[(u + 1) % userIds.length] // ring: user-i → user-(i+1)
    const info = clients.get(fromId)

    if (!info?.ws || info.ws.readyState !== WebSocket.OPEN) continue

    for (let m = 0; m < MSGS_PER_USER; m++) {
      const msgId = crypto.randomUUID()
      const payload = JSON.stringify({
        id: msgId,
        from: fromId,
        to: toId,
        content: `stress-${u}-${m}`,
        type: 'task',
        ts: Date.now(),
        signature: '',
        encrypted: false,
      })
      sentAt.set(msgId, Date.now())
      info.ws.send(payload)
    }
  }

  const sendElapsed = Date.now() - sendStart
  log('send', `All messages dispatched in ${sendElapsed}ms`)

  // Wait up to 10s for acks to arrive
  const ackDeadline = Date.now() + 10_000
  while (Date.now() < ackDeadline && ackedIds.size < sentAt.size) {
    await sleep(200)
  }

  return { sendElapsed }
}

async function cleanup() {
  for (const [, info] of clients) {
    if (info.ws && info.ws.readyState === WebSocket.OPEN) {
      info.ws.close()
    }
  }
  if (hubProcess) {
    hubProcess.kill('SIGTERM')
    await sleep(600)
    if (!hubProcess.killed) hubProcess.kill('SIGKILL')
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('━'.repeat(60))
  console.log('  JackClaw Hub — 压力测试')
  console.log(`  ${NUM_USERS} users × ${MSGS_PER_USER} msgs = ${TOTAL_MSGS} total`)
  console.log('━'.repeat(60))

  const globalTimer = setTimeout(async () => {
    err('main', `Global timeout (${TIMEOUT_MS / 1000}s) — aborting`)
    await cleanup()
    process.exit(2)
  }, TIMEOUT_MS)

  const wallStart = Date.now()

  try {
    await startHub()
    await registerUsers()
    const { connected, connectMs, connectionTimes } = await connectWebSockets()
    await sleep(300) // let WS handshakes settle

    const { sendElapsed } = await sendMessages()

    const wallElapsed = (Date.now() - wallStart) / 1000

    // ─── Stats ───────────────────────────────────────────────────────────────

    const totalSent = sentAt.size
    const totalAcked = ackedIds.size
    const lostCount = totalSent - totalAcked
    const lossRate = totalSent > 0 ? ((lostCount / totalSent) * 100).toFixed(2) : '0.00'

    const throughput = totalSent > 0 && sendElapsed > 0
      ? Math.round((totalSent / sendElapsed) * 1000)
      : 0

    const sorted = [...latencySamples].sort((a, b) => a - b)
    const p50 = percentile(sorted, 50)
    const p95 = percentile(sorted, 95)
    const p99 = percentile(sorted, 99)
    const avgLat = sorted.length > 0
      ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length)
      : 0

    const connP50 = percentile(connectionTimes, 50)
    const connP95 = percentile(connectionTimes, 95)

    console.log('\n' + '━'.repeat(60))
    console.log('  压力测试报告')
    console.log('━'.repeat(60))
    console.log(`  并发用户数          ${NUM_USERS}`)
    console.log(`  每用户消息数        ${MSGS_PER_USER}`)
    console.log(`  总消息数            ${TOTAL_MSGS}`)
    console.log('─'.repeat(60))
    console.log(`  成功连接            ${connected} / ${clients.size}`)
    console.log(`  连接总耗时          ${connectMs} ms`)
    console.log(`  连接时间 P50        ${connP50} ms`)
    console.log(`  连接时间 P95        ${connP95} ms`)
    console.log('─'.repeat(60))
    console.log(`  实际发送            ${totalSent} 条`)
    console.log(`  已确认 (acked)      ${totalAcked} 条`)
    console.log(`  消息丢失            ${lostCount} 条  (${lossRate}%)`)
    console.log(`  发送总耗时          ${sendElapsed} ms`)
    console.log(`  吞吐量              ${throughput} msg/s`)
    console.log('─'.repeat(60))
    console.log(`  延迟样本数          ${sorted.length}`)
    console.log(`  平均延迟            ${avgLat} ms`)
    console.log(`  P50 延迟            ${p50} ms`)
    console.log(`  P95 延迟            ${p95} ms`)
    console.log(`  P99 延迟            ${p99} ms`)
    console.log('─'.repeat(60))
    console.log(`  总运行时间          ${wallElapsed.toFixed(2)} s`)
    console.log('━'.repeat(60))

    if (lostCount > 0) {
      console.log(`\n  ⚠  ${lostCount} 条消息未收到 ACK (可能已投递但未回执)`)
    } else {
      console.log('\n  ✓  所有消息均已确认')
    }

  } catch (e) {
    err('main', e.stack ?? e.message ?? e)
    process.exitCode = 1
  } finally {
    clearTimeout(globalTimer)
    await cleanup()
  }
}

main()
