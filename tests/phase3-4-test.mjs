#!/usr/bin/env node
/**
 * JackClaw Hub Phase 3-4 E2E Test
 *
 * 覆盖流程：
 * 1. 启动 Hub（端口 19803，临时 HOME）
 * 2. Health check
 * 3. POST /api/auth/register → 注册用户
 * 4. POST /api/register → 注册节点
 * 5. POST /api/tenants → 创建 tenant
 * 6. POST /api/audit → 手动写入审计日志
 * 7. GET /api/audit → 查询审计日志
 * 8. POST /api/risk/evaluate → 评估风险
 * 9. GET /api/risk/rules → 列出风控规则
 * 10. GET /api/plugins → 列出插件
 * 11. POST /api/contacts → 创建联系人
 * 12. GET /api/contacts?tenantId=xxx → 列出联系人
 * 13. PATCH /api/contacts/:id → 更新联系人 displayName
 * 14. POST /api/contacts/:id/tags → 添加标签
 * 15. GET /api/dashboard/overview → 概览
 * 16. PUT /api/config/test.key → 设置配置
 * 17. GET /api/config/test.key → 读取配置
 * 18. DELETE /api/config/test.key → 删除配置
 *
 * Usage: node tests/phase3-4-test.mjs
 */

import http from 'http'
import { spawn, execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

const HUB_PORT = 19803
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

function patch(url, body, headers) {
  return request('PATCH', url, { headers, body })
}

function put(url, body, headers) {
  return request('PUT', url, { headers, body })
}

function del(url, headers) {
  return request('DELETE', url, { headers })
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

function expect(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
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
  testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'jackclaw-phase34-'))

  const hubDir = path.join(testHome, '.jackclaw', 'hub')
  fs.mkdirSync(hubDir, { recursive: true })
  fs.writeFileSync(path.join(hubDir, 'config.json'), JSON.stringify({ requireInvite: false, admins: [] }, null, 2))

  log('build', 'Running npx tsc')
  execFileSync('npx', ['tsc', '--project', 'packages/hub/tsconfig.json'], {
    cwd: process.cwd(),
    stdio: 'inherit',
  })

  log('hub', `Starting Hub on ${HUB_PORT}`)
  hubProcess = spawn('node', ['packages/hub/dist/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: testHome,
      HUB_PORT: String(HUB_PORT),
      PORT: String(HUB_PORT),
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
  console.log('🦞 JackClaw Phase 3-4 E2E Test')
  console.log('━'.repeat(50))

  const timer = setTimeout(() => {
    fail(`Global timeout (${TIMEOUT_MS / 1000}s)`)
  }, TIMEOUT_MS)

  try {
    await startHub()

    const healthRes = await get(`${HUB_URL}/health`)
    await expectStatus('GET /health', healthRes, 200)

    const suffix = Date.now().toString(36)
    const handle = `phase34_${suffix}`
    const password = 'secret123'
    const nodeId = `node-${suffix}`

    const registerUserRes = await post(`${HUB_URL}/api/auth/register`, {
      handle,
      password,
      displayName: `Phase34 ${suffix}`,
      email: `${handle}@example.com`,
    })
    await expectStatus('POST /api/auth/register', registerUserRes, 201)

    const userToken = registerUserRes.body?.token
    expect(typeof userToken === 'string' && userToken.length > 0, 'user register did not return token')

    const registerNodeRes = await post(`${HUB_URL}/api/register`, {
      nodeId,
      name: `Node ${suffix}`,
      role: 'ceo',
      publicKey: '-----BEGIN PUBLIC KEY-----\nTEST\n-----END PUBLIC KEY-----',
    })
    await expectStatus('POST /api/register', registerNodeRes, 201)

    const token = registerNodeRes.body?.token
    expect(typeof token === 'string' && token.length > 0, 'node register did not return token')

    const tenantRes = await post(`${HUB_URL}/api/tenants`, {
      name: `Tenant ${suffix}`,
      slug: `tenant-${suffix}`,
      plan: 'pro',
    }, authHeaders(token))
    await expectStatus('POST /api/tenants', tenantRes, 201)

    const tenantId = tenantRes.body?.tenant?.id
    expect(typeof tenantId === 'string' && tenantId.length > 0, 'create tenant did not return tenant.id')

    const createAuditRes = await post(`${HUB_URL}/api/audit`, {
      tenantId,
      method: 'POST',
      path: '/test',
      statusCode: 200,
      result: 'success',
    }, authHeaders(token))
    await expectStatus('POST /api/audit', createAuditRes, 201)

    const getAuditRes = await get(`${HUB_URL}/api/audit`, authHeaders(token))
    await expectStatus('GET /api/audit', getAuditRes, 200)
    expect(getAuditRes.body?.success === true, 'GET /api/audit did not return success=true')

    const evaluateRiskRes = await post(`${HUB_URL}/api/risk/evaluate`, {
      tenantId,
      actorId: nodeId,
      actorType: 'user',
      action: 'test_action',
      timestamp: Date.now(),
    }, authHeaders(token))
    await expectStatus('POST /api/risk/evaluate', evaluateRiskRes, 200)
    expect(evaluateRiskRes.body?.success === true, 'risk evaluate did not return success=true')

    const listRulesRes = await get(`${HUB_URL}/api/risk/rules`, authHeaders(token))
    await expectStatus('GET /api/risk/rules', listRulesRes, 200)
    expect(Array.isArray(listRulesRes.body?.rules), 'risk rules response did not include rules array')

    const listPluginsRes = await get(`${HUB_URL}/api/plugins`, authHeaders(token))
    await expectStatus('GET /api/plugins', listPluginsRes, 200)
    expect(Array.isArray(listPluginsRes.body?.data), 'plugins response did not include data array')
    expect(listPluginsRes.body.data.length === 0, 'plugins array is not empty')

    const createContactRes = await post(`${HUB_URL}/api/contacts`, {
      tenantId,
      name: 'Test Contact',
      type: 'customer',
    }, authHeaders(token))
    await expectStatus('POST /api/contacts', createContactRes, 201)

    const contactId = createContactRes.body?.contact?.id
    expect(typeof contactId === 'string' && contactId.length > 0, 'create contact did not return contact.id')

    const listContactsRes = await get(`${HUB_URL}/api/contacts?tenantId=${encodeURIComponent(tenantId)}`, authHeaders(token))
    await expectStatus('GET /api/contacts', listContactsRes, 200)
    expect(Array.isArray(listContactsRes.body?.contacts), 'contacts response did not include contacts array')
    expect(listContactsRes.body.contacts.some(contact => contact.id === contactId), 'created contact not found in list')

    const updateContactRes = await patch(`${HUB_URL}/api/contacts/${encodeURIComponent(contactId)}`, {
      displayName: 'Updated Contact',
    }, authHeaders(token))
    await expectStatus('PATCH /api/contacts/:id', updateContactRes, 200)
    expect(updateContactRes.body?.contact?.displayName === 'Updated Contact', 'contact displayName was not updated')

    const addTagRes = await post(`${HUB_URL}/api/contacts/${encodeURIComponent(contactId)}/tags`, {
      tag: 'vip',
    }, authHeaders(token))
    await expectStatus('POST /api/contacts/:id/tags', addTagRes, 201)
    expect(Array.isArray(addTagRes.body?.contact?.tags) && addTagRes.body.contact.tags.includes('vip'), 'contact tag was not added')

    const dashboardOverviewRes = await get(`${HUB_URL}/api/dashboard/overview`, authHeaders(token))
    await expectStatus('GET /api/dashboard/overview', dashboardOverviewRes, 200)
    expect(typeof dashboardOverviewRes.body?.totalContacts === 'number', 'dashboard overview missing totalContacts')

    const putConfigRes = await put(`${HUB_URL}/api/config/test.key`, {
      value: 'hello',
      scope: 'global',
    }, authHeaders(token))
    await expectStatus('PUT /api/config/test.key', putConfigRes, 200)

    const getConfigRes = await get(`${HUB_URL}/api/config/test.key?scope=global`, authHeaders(token))
    await expectStatus('GET /api/config/test.key', getConfigRes, 200)
    expect(getConfigRes.body?.config === 'hello' || getConfigRes.body?.config?.value === 'hello', 'config value mismatch')

    const deleteConfigRes = await del(`${HUB_URL}/api/config/test.key?scope=global`, authHeaders(token))
    await expectStatus('DELETE /api/config/test.key', deleteConfigRes, 200)

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
