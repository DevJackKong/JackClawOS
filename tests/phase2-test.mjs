#!/usr/bin/env node
/**
 * JackClaw Hub Phase 2 E2E Test
 *
 * 覆盖流程：
 * 1. 注册用户 + 注册节点（获取 CEO token）
 * 2. 创建 tenant
 * 3. POST /api/task-state — 创建任务
 * 4. GET /api/task-state — 列出任务
 * 5. POST /api/task-state/:id/assign — 分配任务
 * 6. POST /api/task-state/:id/transition — 状态转换 (start)
 * 7. POST /api/task-state/:id/transition — 状态转换 (complete)
 * 8. GET /api/task-state/:id/history — 查看历史
 * 9. POST /api/approvals — 创建审批
 * 10. GET /api/approvals/pending — 查看待审批
 * 11. POST /api/approvals/:id/approve — 批准
 * 12. GET /api/traces — 查询 traces
 * 13. GET /api/chat-context/:nodeId — 查看聊天上下文
 *
 * Usage: node tests/phase2-test.mjs
 */

import http from 'http'
import { spawn, execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

const HUB_PORT = 19802
const HUB_URL = `http://127.0.0.1:${HUB_PORT}`
const TIMEOUT_MS = 40_000

let hubProcess = null
let testHome = null

function log(tag, msg) {
  const ts = new Date().toISOString().slice(11, 23)
  console.log(`[${ts}] [${tag}] ${msg}`)
}

function pass(msg) {
  console.log(`✅ PASS: ${msg}`)
}

async function fail(msg) {
  console.error(`❌ FAIL: ${msg}`)
  await cleanup()
  process.exit(1)
}

function waitFor(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function cleanup() {
  log('cleanup', 'Cleaning up...')

  if (hubProcess) {
    hubProcess.kill('SIGTERM')
    await waitFor(500)
    if (!hubProcess.killed) hubProcess.kill('SIGKILL')
  }

  if (testHome) {
    try {
      fs.rmSync(testHome, { recursive: true, force: true })
    } catch {}
  }
}

function request(method, url, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const payload = body === undefined ? null : JSON.stringify(body)

    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: `${u.pathname}${u.search}`,
      method,
      headers: {
        ...headers,
        ...(payload ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        } : {}),
      },
    }, (res) => {
      let buf = ''
      res.on('data', chunk => { buf += chunk })
      res.on('end', () => {
        let parsed = buf
        try { parsed = buf ? JSON.parse(buf) : null } catch {}
        resolve({ status: res.statusCode, body: parsed })
      })
    })

    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function get(url, headers) {
  return request('GET', url, { headers })
}

function post(url, body, headers) {
  return request('POST', url, { headers, body })
}

function authHeaders(token, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    ...extra,
  }
}

async function expectStatus(step, res, expected) {
  if (res.status !== expected) {
    await fail(`${step} expected HTTP ${expected}, got ${res.status}: ${JSON.stringify(res.body)}`)
  }
  pass(`${step} -> HTTP ${expected}`)
}

async function waitForHub(timeoutMs = 10_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await get(`${HUB_URL}/health`)
      if (res.status === 200) return true
    } catch {}
    await waitFor(300)
  }
  return false
}

async function startHub() {
  testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'jackclaw-phase2-'))

  const hubDir = path.join(testHome, '.jackclaw', 'hub')
  fs.mkdirSync(hubDir, { recursive: true })
  fs.writeFileSync(path.join(hubDir, 'config.json'), JSON.stringify({ requireInvite: false, admins: [] }, null, 2))

  log('build', 'Building packages/hub')
  execFileSync('npm', ['run', 'build', '--workspace=packages/hub'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: {
      ...process.env,
      HOME: testHome,
    },
  })

  log('hub', `Starting Hub on ${HUB_PORT}`)
  hubProcess = spawn('node', ['packages/hub/dist/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: testHome,
      PORT: String(HUB_PORT),
      HUB_PORT: String(HUB_PORT),
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  hubProcess.stdout.on('data', chunk => {
    const line = chunk.toString().trim()
    if (line) log('hub', line)
  })

  hubProcess.stderr.on('data', chunk => {
    const line = chunk.toString().trim()
    if (line) log('hub:err', line)
  })

  hubProcess.on('exit', code => {
    log('hub', `Process exited with code ${code}`)
  })

  const ready = await waitForHub()
  if (!ready) await fail('Hub did not start within 10s')
  pass('Hub started and healthy')
}

async function main() {
  console.log('🦞 JackClaw Phase 2 E2E Test')
  console.log('━'.repeat(50))

  const timer = setTimeout(() => {
    fail(`Global timeout (${TIMEOUT_MS / 1000}s)`)
  }, TIMEOUT_MS)

  try {
    await startHub()

    const suffix = Date.now().toString(36)
    const handle = `phase2_${suffix}`
    const password = 'secret123'
    const nodeId = `ceo-${suffix}`

    // 1. 注册用户 + 注册节点（获取 CEO token）
    const registerUserRes = await post(`${HUB_URL}/api/auth/register`, {
      handle,
      password,
      displayName: `Phase2 ${suffix}`,
      email: `${handle}@example.com`,
    })
    await expectStatus('POST /api/auth/register', registerUserRes, 201)

    const registerNodeRes = await post(`${HUB_URL}/api/register`, {
      nodeId,
      name: `CEO ${suffix}`,
      role: 'ceo',
      publicKey: '-----BEGIN PUBLIC KEY-----\nTEST\n-----END PUBLIC KEY-----',
    })
    await expectStatus('POST /api/register', registerNodeRes, 201)

    const ceoToken = registerNodeRes.body?.token
    if (!ceoToken) await fail('node register did not return token')

    // 2. 创建 tenant
    const tenantRes = await post(`${HUB_URL}/api/tenants`, {
      name: `Tenant ${suffix}`,
      slug: `tenant-${suffix}`,
      plan: 'pro',
    }, authHeaders(ceoToken))
    await expectStatus('POST /api/tenants', tenantRes, 201)

    const tenant = tenantRes.body?.tenant
    if (!tenant?.id) await fail('create tenant did not return tenant.id')

    // 3. POST /api/task-state — 创建任务
    const createTaskRes = await post(`${HUB_URL}/api/task-state`, {
      tenantId: tenant.id,
      title: `Task ${suffix}`,
      description: 'phase2 task flow test',
      creatorId: nodeId,
      priority: 'high',
      metadata: { suite: 'phase2' },
    }, authHeaders(ceoToken))
    await expectStatus('POST /api/task-state', createTaskRes, 201)

    const task = createTaskRes.body?.task
    if (!task?.id) await fail('create task did not return task.id')

    // 4. GET /api/task-state — 列出任务
    const listTasksRes = await get(`${HUB_URL}/api/task-state?tenantId=${encodeURIComponent(tenant.id)}`, authHeaders(ceoToken))
    await expectStatus('GET /api/task-state', listTasksRes, 200)

    const tasks = listTasksRes.body?.tasks
    if (!Array.isArray(tasks) || !tasks.find(item => item.id === task.id)) {
      await fail('task not found in GET /api/task-state response')
    }

    // 5. POST /api/task-state/:id/assign — 分配任务
    const assignTaskRes = await post(`${HUB_URL}/api/task-state/${task.id}/assign`, {
      assigneeId: nodeId,
      actorId: nodeId,
    }, authHeaders(ceoToken))
    await expectStatus('POST /api/task-state/:id/assign', assignTaskRes, 200)

    // 6. POST /api/task-state/:id/transition — 状态转换 (start)
    const startTaskRes = await post(`${HUB_URL}/api/task-state/${task.id}/transition`, {
      event: 'start',
      actorId: nodeId,
    }, authHeaders(ceoToken))
    await expectStatus('POST /api/task-state/:id/transition (start)', startTaskRes, 200)

    // 7. POST /api/task-state/:id/transition — 状态转换 (complete)
    const completeTaskRes = await post(`${HUB_URL}/api/task-state/${task.id}/transition`, {
      event: 'complete',
      actorId: nodeId,
    }, authHeaders(ceoToken))
    await expectStatus('POST /api/task-state/:id/transition (complete)', completeTaskRes, 200)

    // 8. GET /api/task-state/:id/history — 查看历史
    const taskHistoryRes = await get(`${HUB_URL}/api/task-state/${task.id}/history`, authHeaders(ceoToken))
    await expectStatus('GET /api/task-state/:id/history', taskHistoryRes, 200)

    const history = taskHistoryRes.body?.history
    if (!Array.isArray(history) || history.length < 3) {
      await fail('task history is missing expected entries')
    }

    // 9. POST /api/approvals — 创建审批
    const createApprovalRes = await post(`${HUB_URL}/api/approvals`, {
      tenantId: tenant.id,
      type: 'external_action',
      title: `Approval ${suffix}`,
      description: 'phase2 approval flow test',
      requestedBy: nodeId,
      metadata: { suite: 'phase2', taskId: task.id },
    }, authHeaders(ceoToken))
    await expectStatus('POST /api/approvals', createApprovalRes, 201)

    const approval = createApprovalRes.body?.approval
    if (!approval?.id) await fail('create approval did not return approval.id')

    // 10. GET /api/approvals/pending — 查看待审批
    const pendingApprovalsRes = await get(`${HUB_URL}/api/approvals/pending?tenantId=${encodeURIComponent(tenant.id)}`, authHeaders(ceoToken))
    await expectStatus('GET /api/approvals/pending', pendingApprovalsRes, 200)

    const approvals = pendingApprovalsRes.body?.approvals
    if (!Array.isArray(approvals) || !approvals.find(item => item.id === approval.id)) {
      await fail('approval not found in GET /api/approvals/pending response')
    }

    // 11. POST /api/approvals/:id/approve — 批准
    const approveRes = await post(`${HUB_URL}/api/approvals/${approval.id}/approve`, {
      approvedBy: nodeId,
      reason: 'approved in phase2 test',
    }, authHeaders(ceoToken))
    await expectStatus('POST /api/approvals/:id/approve', approveRes, 200)

    // 为 traces/chat-context 补一条 trace，确保后续可查询
    const createTraceRes = await post(`${HUB_URL}/api/traces`, {
      tenantId: tenant.id,
      type: 'task',
      action: 'phase2.completed',
      actorId: nodeId,
      targetId: task.id,
      metadata: { approvalId: approval.id },
    }, authHeaders(ceoToken))
    await expectStatus('POST /api/traces', createTraceRes, 201)

    // 12. GET /api/traces — 查询 traces
    const tracesRes = await get(`${HUB_URL}/api/traces?tenantId=${encodeURIComponent(tenant.id)}&limit=20`, authHeaders(ceoToken))
    await expectStatus('GET /api/traces', tracesRes, 200)

    if (!Array.isArray(tracesRes.body?.traces)) {
      await fail('GET /api/traces did not return traces array')
    }

    // 13. GET /api/chat-context/:nodeId — 查看聊天上下文
    const chatContextRes = await get(`${HUB_URL}/api/chat-context/${encodeURIComponent(nodeId)}?tenantId=${encodeURIComponent(tenant.id)}`, authHeaders(ceoToken))
    await expectStatus('GET /api/chat-context/:nodeId', chatContextRes, 200)

    clearTimeout(timer)
    console.log('━'.repeat(50))
    console.log('PASS')
  } catch (err) {
    clearTimeout(timer)
    await fail(err?.message || String(err))
    return
  } finally {
    await cleanup()
  }
}

main()
