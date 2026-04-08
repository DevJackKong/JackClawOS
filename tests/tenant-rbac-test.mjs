#!/usr/bin/env node
/**
 * JackClaw Hub Tenant/RBAC E2E Test
 *
 * 覆盖流程：
 * - POST /api/auth/register
 * - POST /api/tenants
 * - GET /api/tenants
 * - GET /api/tenants/:id
 * - POST /api/orgs
 * - GET /api/orgs
 * - POST /api/members
 * - GET /api/members
 * - POST /api/roles
 * - GET /api/roles
 * - POST /api/roles/assign
 *
 * Usage: node tests/tenant-rbac-test.mjs
 */

import http from 'http'
import { spawn, execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

const HUB_PORT = 19801
const HUB_URL = `http://127.0.0.1:${HUB_PORT}`
const TIMEOUT_MS = 30_000

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

function waitFor(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
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
  testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'jackclaw-tenant-rbac-'))

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

  log('step1', `Starting Hub on ${HUB_PORT}`)
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
  console.log('🦞 JackClaw Tenant/RBAC E2E Test')
  console.log('━'.repeat(50))

  const timer = setTimeout(() => {
    fail(`Global timeout (${TIMEOUT_MS / 1000}s)`)
  }, TIMEOUT_MS)

  try {
    await startHub()

    const suffix = Date.now().toString(36)
    const handle = `admin_${suffix}`
    const password = 'secret123'
    const displayName = `Admin ${suffix}`

    const registerRes = await post(`${HUB_URL}/api/auth/register`, {
      handle,
      password,
      displayName,
      email: `${handle}@example.com`,
    })
    await expectStatus('POST /api/auth/register', registerRes, 201)

    const userToken = registerRes.body?.token
    if (!userToken) await fail('register did not return token')

    const tenantRes = await post(`${HUB_URL}/api/tenants`, {
      name: `Tenant ${suffix}`,
      slug: `tenant-${suffix}`,
      plan: 'pro',
    }, authHeaders(userToken))
    await expectStatus('POST /api/tenants', tenantRes, 403)

    const nodeRegisterRes = await post(`${HUB_URL}/api/register`, {
      nodeId: `ceo-${suffix}`,
      name: `CEO ${suffix}`,
      role: 'ceo',
      publicKey: '-----BEGIN PUBLIC KEY-----\nTEST\n-----END PUBLIC KEY-----',
    })
    await expectStatus('POST /api/register', nodeRegisterRes, 201)

    const ceoToken = nodeRegisterRes.body?.token
    if (!ceoToken) await fail('node register did not return token')

    const createTenantRes = await post(`${HUB_URL}/api/tenants`, {
      name: `Tenant ${suffix}`,
      slug: `tenant-${suffix}`,
      plan: 'pro',
    }, authHeaders(ceoToken))
    await expectStatus('POST /api/tenants', createTenantRes, 201)

    const tenant = createTenantRes.body?.tenant
    if (!tenant?.id) await fail('create tenant did not return tenant.id')

    const listTenantsRes = await get(`${HUB_URL}/api/tenants`, authHeaders(ceoToken))
    await expectStatus('GET /api/tenants', listTenantsRes, 200)

    const tenants = listTenantsRes.body?.tenants
    if (!Array.isArray(tenants) || !tenants.find(item => item.id === tenant.id)) {
      await fail('tenant not found in GET /api/tenants response')
    }

    const getTenantRes = await get(`${HUB_URL}/api/tenants/${tenant.id}`, authHeaders(ceoToken))
    await expectStatus('GET /api/tenants/:id', getTenantRes, 200)

    const orgRes = await post(`${HUB_URL}/api/orgs`, {
      tenantId: tenant.id,
      name: `Org ${suffix}`,
      slug: `org-${suffix}`,
    }, authHeaders(ceoToken, { 'X-Tenant-Id': tenant.id }))
    await expectStatus('POST /api/orgs', orgRes, 201)

    const org = orgRes.body?.org
    if (!org?.id) await fail('create org did not return org.id')

    const listOrgsRes = await get(`${HUB_URL}/api/orgs`, authHeaders(ceoToken, { 'X-Tenant-Id': tenant.id }))
    await expectStatus('GET /api/orgs', listOrgsRes, 200)

    const organizations = listOrgsRes.body?.organizations
    if (!Array.isArray(organizations) || !organizations.find(item => item.id === org.id)) {
      await fail('org not found in GET /api/orgs response')
    }

    const memberRes = await post(`${HUB_URL}/api/members`, {
      tenantId: tenant.id,
      orgId: org.id,
      userId: registerRes.body?.user?.handle ?? handle,
      role: 'owner',
    }, authHeaders(ceoToken, { 'X-Tenant-Id': tenant.id }))
    await expectStatus('POST /api/members', memberRes, 201)

    const member = memberRes.body?.member
    if (!member?.id) await fail('create member did not return member.id')

    const listMembersRes = await get(`${HUB_URL}/api/members?orgId=${encodeURIComponent(org.id)}`, authHeaders(ceoToken, { 'X-Tenant-Id': tenant.id }))
    await expectStatus('GET /api/members', listMembersRes, 200)

    const members = listMembersRes.body?.members
    if (!Array.isArray(members) || !members.find(item => item.id === member.id)) {
      await fail('member not found in GET /api/members response')
    }

    const roleRes = await post(`${HUB_URL}/api/roles`, {
      name: `manager_${suffix}`,
      displayName: 'Manager',
      permissions: [
        { resource: 'members', action: 'write', scope: 'org' },
        { resource: 'rbac', action: 'write', scope: 'tenant' },
      ],
    }, authHeaders(ceoToken, { 'X-Tenant-Id': tenant.id }))
    await expectStatus('POST /api/roles', roleRes, 201)

    const role = roleRes.body?.role
    if (!role?.id) await fail('create role did not return role.id')

    const listRolesRes = await get(`${HUB_URL}/api/roles`, authHeaders(ceoToken, { 'X-Tenant-Id': tenant.id }))
    await expectStatus('GET /api/roles', listRolesRes, 200)

    const roles = listRolesRes.body?.roles
    if (!Array.isArray(roles) || !roles.find(item => item.id === role.id)) {
      await fail('role not found in GET /api/roles response')
    }

    const assignRoleRes = await post(`${HUB_URL}/api/roles/assign`, {
      userId: registerRes.body?.user?.handle ?? handle,
      roleId: role.id,
      orgId: org.id,
    }, authHeaders(ceoToken, { 'X-Tenant-Id': tenant.id }))
    await expectStatus('POST /api/roles/assign', assignRoleRes, 201)

    if (!assignRoleRes.body?.assignment?.id) {
      await fail('role assignment did not return assignment.id')
    }

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
