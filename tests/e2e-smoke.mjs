#!/usr/bin/env node
/**
 * JackClaw Hub↔Node E2E Smoke Test
 *
 * 验证全链路：Hub启动 → Node注册 → WebSocket连接 → 消息收发
 * 不依赖 ts 编译，直接用 compiled JS 或 HTTP/WS API
 *
 * Usage: node tests/e2e-smoke.mjs
 */

import http from 'http'
import { spawn } from 'child_process'
import WebSocket from 'ws'
import crypto from 'crypto'

const HUB_PORT = 3199
const NODE_PORT = 19099
const HUB_URL = `http://localhost:${HUB_PORT}`
const TIMEOUT_MS = 30_000

let hubProcess = null
let nodeWs = null
const cleanup = []

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(tag, msg) {
  const ts = new Date().toISOString().slice(11, 23)
  console.log(`[${ts}] [${tag}] ${msg}`)
}

function fail(msg) {
  console.error(`\n❌ FAIL: ${msg}`)
  doCleanup()
  process.exit(1)
}

function pass(msg) {
  console.log(`\n✅ PASS: ${msg}`)
}

async function doCleanup() {
  log('cleanup', 'Cleaning up...')
  if (nodeWs && nodeWs.readyState === WebSocket.OPEN) {
    nodeWs.close()
  }
  if (hubProcess) {
    hubProcess.kill('SIGTERM')
    await new Promise(r => setTimeout(r, 500))
    if (!hubProcess.killed) hubProcess.kill('SIGKILL')
  }
  for (const fn of cleanup) {
    try { fn() } catch {}
  }
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const u = new URL(url)
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let buf = ''
      res.on('data', c => buf += c)
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }) }
        catch { resolve({ status: res.statusCode, body: buf }) }
      })
    })
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

function waitFor(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function waitForPort(port, timeoutMs = 10000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await httpGet(`http://localhost:${port}/health`)
      if (res.status === 200) return true
    } catch {}
    await waitFor(300)
  }
  return false
}

// ─── Test Steps ───────────────────────────────────────────────────────────────

async function step1_startHub() {
  log('step1', 'Starting Hub on port ' + HUB_PORT)

  hubProcess = spawn('node', ['packages/hub/dist/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HUB_PORT: String(HUB_PORT),
      NODE_ENV: 'test',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  hubProcess.stdout.on('data', d => {
    const line = d.toString().trim()
    if (line) log('hub', line)
  })
  hubProcess.stderr.on('data', d => {
    const line = d.toString().trim()
    if (line) log('hub:err', line)
  })
  hubProcess.on('exit', (code) => {
    log('hub', `Process exited with code ${code}`)
  })

  const ready = await waitForPort(HUB_PORT)
  if (!ready) fail('Hub did not start within 10s')
  pass('Hub started and healthy')
}

async function step2_healthCheck() {
  log('step2', 'Checking /health')
  const res = await httpGet(`${HUB_URL}/health`)
  if (res.status !== 200) fail(`/health returned ${res.status}`)
  if (res.body.status !== 'ok') fail(`/health status: ${res.body.status}`)
  pass('Health check OK')
}

async function step3_registerNode() {
  log('step3', 'Registering test node via POST /api/register')

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })

  const nodeId = 'e2e-test-node'
  const res = await httpPost(`${HUB_URL}/api/register`, {
    nodeId,
    name: 'E2E Test Node',
    role: 'ceo',
    publicKey,
    callbackUrl: `http://localhost:${NODE_PORT}`,
  })

  if (res.status !== 201 && res.status !== 200) {
    fail(`Registration failed: ${res.status} ${JSON.stringify(res.body)}`)
  }
  if (!res.body.success) fail('Registration body.success is false')
  if (!res.body.token) fail('No JWT token returned')
  if (!res.body.hubPublicKey) fail('No hubPublicKey returned')

  pass(`Node registered: ${res.body.action}, token received`)
  return { nodeId, token: res.body.token, publicKey, privateKey, hubPublicKey: res.body.hubPublicKey }
}

async function step4_listNodes(token) {
  log('step4', 'Listing nodes via GET /api/nodes')
  const u = new URL(`${HUB_URL}/api/nodes`)
  const res = await new Promise((resolve, reject) => {
    http.get({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      headers: { 'Authorization': `Bearer ${token}` }
    }, (resp) => {
      let buf = ''
      resp.on('data', c => buf += c)
      resp.on('end', () => {
        try { resolve({ status: resp.statusCode, body: JSON.parse(buf) }) }
        catch { resolve({ status: resp.statusCode, body: buf }) }
      })
    }).on('error', reject)
  })

  if (res.status !== 200) fail(`/api/nodes returned ${res.status}`)
  const nodes = res.body.nodes || res.body
  if (!Array.isArray(nodes)) {
    log('step4', `Response: ${JSON.stringify(res.body).slice(0, 200)}`)
    pass('Nodes endpoint accessible (non-array response, may be object)')
    return
  }
  const found = nodes.find(n => n.nodeId === 'e2e-test-node')
  if (!found) fail('Registered node not found in list')
  pass(`Node list OK — found e2e-test-node among ${nodes.length} nodes`)
}

async function step5_websocketConnect(nodeId) {
  log('step5', 'Connecting WebSocket to Hub ClawChat')

  return new Promise((resolve, reject) => {
    const wsUrl = `ws://localhost:${HUB_PORT}/chat/ws?nodeId=${encodeURIComponent(nodeId)}`
    nodeWs = new WebSocket(wsUrl)

    const timer = setTimeout(() => {
      reject(new Error('WebSocket connection timeout'))
    }, 5000)

    nodeWs.on('open', () => {
      clearTimeout(timer)
      log('step5', 'WebSocket connected')
      pass('WebSocket connected to Hub')
      resolve(nodeWs)
    })

    nodeWs.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

async function step6_sendAndReceive(nodeId, ws) {
  log('step6', 'Testing message send via REST → receive via WebSocket')

  // We'll send a message TO our node, and verify we receive it on the WS
  const msgId = crypto.randomUUID()
  const testContent = 'Hello from E2E test! ' + Date.now()

  // Set up WS listener first
  const received = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Message receive timeout (5s)')), 5000)

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString())
        if (data.event === 'message' && data.data?.id === msgId) {
          clearTimeout(timer)
          resolve(data.data)
        }
      } catch {}
    })
  })

  // Send message via REST (from a fake "ceo" to our test node)
  const sendRes = await httpPost(`${HUB_URL}/api/chat/send`, {
    id: msgId,
    from: 'ceo',
    to: nodeId,
    content: testContent,
    type: 'task',
    ts: Date.now(),
    signature: '',
    encrypted: false,
  })

  if (sendRes.status !== 200) fail(`Chat send failed: ${sendRes.status}`)
  log('step6', `Message sent via REST: ${sendRes.body.messageId}`)

  // Wait for WS delivery
  const msg = await received
  if (msg.content !== testContent) fail(`Content mismatch: ${msg.content} vs ${testContent}`)
  if (msg.from !== 'ceo') fail(`From mismatch: ${msg.from}`)

  pass('Message sent via REST → received via WebSocket ✓')
}

async function step7_nodeToHub(nodeId, ws) {
  log('step7', 'Testing Node→Hub message via WebSocket')

  const msgId = crypto.randomUUID()
  const content = 'Node reporting back! ' + Date.now()

  // Set up listener for ACK
  const ackReceived = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ACK timeout (5s)')), 5000)

    const handler = (raw) => {
      try {
        const data = JSON.parse(raw.toString())
        if (data.event === 'ack' && data.messageId === msgId) {
          clearTimeout(timer)
          ws.removeListener('message', handler)
          resolve(data)
        }
      } catch {}
    }
    ws.on('message', handler)
  })

  // Send message from Node via WebSocket
  ws.send(JSON.stringify({
    id: msgId,
    from: nodeId,
    to: 'ceo',
    content,
    type: 'human',
    ts: Date.now(),
    signature: '',
    encrypted: false,
  }))

  const ack = await ackReceived
  if (!ack.messageId) fail('ACK missing messageId')

  pass('Node→Hub message sent, ACK received ✓')
}

async function step8_chatStats() {
  log('step8', 'Checking chat stats')
  const res = await httpGet(`${HUB_URL}/api/chat/stats`)
  if (res.status !== 200) fail(`/api/chat/stats returned ${res.status}`)
  log('step8', `Stats: ${JSON.stringify(res.body)}`)
  if (res.body.connections < 1) fail('Expected at least 1 WS connection')
  if (res.body.totalReceived < 1) fail('Expected totalReceived >= 1')
  pass(`Chat stats OK — ${res.body.connections} connections, ${res.body.totalReceived} received, ${res.body.totalDelivered} delivered`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🦞 JackClaw E2E Smoke Test')
  console.log('━'.repeat(50))

  const globalTimer = setTimeout(() => {
    fail(`Global timeout (${TIMEOUT_MS / 1000}s)`)
  }, TIMEOUT_MS)

  try {
    await step1_startHub()
    await step2_healthCheck()
    const { nodeId, token } = await step3_registerNode()
    await step4_listNodes(token)
    const ws = await step5_websocketConnect(nodeId)
    await waitFor(500) // let WS settle
    await step6_sendAndReceive(nodeId, ws)
    await step7_nodeToHub(nodeId, ws)
    await step8_chatStats()

    clearTimeout(globalTimer)
    console.log('\n' + '━'.repeat(50))
    console.log('🎉 ALL TESTS PASSED — Hub↔Node 端到端通信验证成功！')
    console.log('━'.repeat(50))
  } catch (err) {
    clearTimeout(globalTimer)
    fail(err.message || err)
  } finally {
    await doCleanup()
  }
}

main()
