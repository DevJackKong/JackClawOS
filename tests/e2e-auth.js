#!/usr/bin/env node
/**
 * JackClaw E2E: Auth System Tests
 *
 * Tests the complete user account lifecycle:
 *   register → login → get-me → profile-update → password-change
 *   duplicate-register → wrong-password → invalid-token
 *   handle availability → user list
 *
 * Can be run standalone: node tests/e2e-auth.js
 * Or imported by run-all.js: module.exports.runTests(hubUrl)
 */
'use strict'

const http   = require('http')
const net    = require('net')
const { spawn } = require('child_process')
const path   = require('path')
const fs     = require('fs')
const os     = require('os')

// ─── Runtime state ────────────────────────────────────────────────────────────

let HUB_URL    = process.env.HUB_URL || ''
let hubProcess = null
let passed     = 0
let failed     = 0
const JWT_SECRET = 'e2e-test-secret'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function req(method, urlPath, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, HUB_URL)
    const payload = body ? JSON.stringify(body) : null
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload)
    const opts = {
      hostname: url.hostname, port: url.port,
      path: url.pathname + url.search, method, headers, timeout: 8000,
    }
    const r = http.request(opts, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        try { resolve({ s: res.statusCode, b: JSON.parse(d) }) }
        catch { resolve({ s: res.statusCode, b: d }) }
      })
    })
    r.on('error', reject)
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')) })
    if (payload) r.write(payload)
    r.end()
  })
}

function ok(name, cond) {
  if (cond) { console.log(`  ✅ ${name}`); passed++ }
  else       { console.log(`  ❌ ${name}`); failed++ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function findFreePort() {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => resolve(port))
    })
  })
}

// ─── Hub Startup ──────────────────────────────────────────────────────────────

async function startHub(port) {
  const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jackclaw-auth-'))
  console.log('\n🔷 Starting Hub for auth tests...')
  const script = `
    const { createServer } = require('./packages/hub/dist/server.js')
    const app = createServer()
    app.listen(${port}, () => console.log('HUB_READY'))
  `
  hubProcess = spawn('node', ['-e', script], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, JWT_SECRET, NODE_ENV: 'test', HOME: TEST_HOME, HUB_PORT: String(port) },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  hubProcess.stdout.on('data', () => {})
  hubProcess.stderr.on('data', (d) => {
    const m = d.toString().trim()
    if (m && !m.includes('Warning') && !m.includes('ExperimentalWarning')) {
      console.log(`  [hub:err] ${m}`)
    }
  })
  for (let i = 0; i < 40; i++) {
    await sleep(300)
    try {
      const r = await req('GET', '/health')
      if (r.s === 200) { console.log('  Hub ready.'); return }
    } catch {}
  }
  throw new Error('Hub failed to start within 12s')
}

// ─── Test Suites ──────────────────────────────────────────────────────────────

async function testRegisterAndLogin() {
  console.log('\n🔷 Auth: Register + Login')

  // Register alice
  const r1 = await req('POST', '/api/auth/register', {
    handle: 'alice_auth_test',
    password: 'password123',
    displayName: 'Alice Auth',
    email: 'alice@test.example',
  })
  ok('Register → 201', r1.s === 201)
  ok('Register returns token', typeof r1.b?.token === 'string' && r1.b.token.length > 20)
  ok('Register returns user.handle', r1.b?.user?.handle === 'alice_auth_test')
  ok('Register returns user.displayName', r1.b?.user?.displayName === 'Alice Auth')
  ok('Register returns agentNodeId', typeof r1.b?.user?.agentNodeId === 'string')
  ok('No passwordHash in response', !('passwordHash' in (r1.b?.user ?? {})))
  ok('No passwordSalt in response', !('passwordSalt' in (r1.b?.user ?? {})))

  const aliceToken = r1.b?.token

  // Login alice
  const r2 = await req('POST', '/api/auth/login', {
    handle: 'alice_auth_test',
    password: 'password123',
  })
  ok('Login → 200', r2.s === 200)
  ok('Login returns token', typeof r2.b?.token === 'string')
  ok('Login user.handle matches', r2.b?.user?.handle === 'alice_auth_test')

  return aliceToken
}

async function testGetMe(aliceToken) {
  console.log('\n🔷 Auth: GET /api/auth/me')

  const r1 = await req('GET', '/api/auth/me', null, aliceToken)
  ok('GET /me → 200', r1.s === 200)
  ok('Returns handle', r1.b?.handle === 'alice_auth_test')
  ok('Returns displayName', typeof r1.b?.displayName === 'string')

  // No token → 401
  const r2 = await req('GET', '/api/auth/me')
  ok('No token → 401', r2.s === 401)

  // Invalid token → 401
  const r3 = await req('GET', '/api/auth/me', null, 'totally.invalid.token')
  ok('Invalid token → 401', r3.s === 401)
}

async function testDuplicateRegister() {
  console.log('\n🔷 Auth: Duplicate Registration → 409')

  const r = await req('POST', '/api/auth/register', {
    handle: 'alice_auth_test',
    password: 'different_password',
    displayName: 'Alice Dupe',
  })
  ok('Duplicate register → 409', r.s === 409)
  ok('Returns error message', typeof r.b?.error === 'string')
}

async function testWrongPassword() {
  console.log('\n🔷 Auth: Wrong Password → 401')

  const r = await req('POST', '/api/auth/login', {
    handle: 'alice_auth_test',
    password: 'this_is_wrong',
  })
  ok('Wrong password → 401', r.s === 401)
  ok('Returns error', typeof r.b?.error === 'string')
}

async function testProfileUpdate(aliceToken) {
  console.log('\n🔷 Auth: PATCH /api/auth/profile')

  const r = await req('PATCH', '/api/auth/profile', {
    displayName: 'Alice Updated',
    bio: 'Updated bio for testing',
  }, aliceToken)
  ok('Profile update → 200', r.s === 200)
  ok('displayName updated', r.b?.displayName === 'Alice Updated')
  ok('bio updated', r.b?.bio === 'Updated bio for testing')

  // Verify via /me
  const r2 = await req('GET', '/api/auth/me', null, aliceToken)
  ok('Profile persisted in /me', r2.b?.displayName === 'Alice Updated')
}

async function testHandleAvailability() {
  console.log('\n🔷 Auth: Handle Availability Check')

  // Taken handle
  const r1 = await req('POST', '/api/auth/check-handle', { handle: 'alice_auth_test' })
  ok('Taken handle → available:false', r1.s === 200 && r1.b?.available === false)

  // Free handle
  const r2 = await req('POST', '/api/auth/check-handle', { handle: 'completely_free_handle_xyz99' })
  ok('Free handle → available:true', r2.s === 200 && r2.b?.available === true)

  // Too short
  const r3 = await req('POST', '/api/auth/check-handle', { handle: 'ab' })
  ok('Handle < 3 chars → available:false', r3.s === 200 && r3.b?.available === false)

  // Missing field → 400
  const r4 = await req('POST', '/api/auth/check-handle', {})
  ok('Missing handle → 400', r4.s === 400)
}

async function testChangePassword(aliceToken) {
  console.log('\n🔷 Auth: POST /api/auth/change-password')

  const r1 = await req('POST', '/api/auth/change-password', {
    oldPassword: 'password123',
    newPassword: 'newSecurePass789',
  }, aliceToken)
  ok('Change password → 200', r1.s === 200)
  ok('Returns ok:true', r1.b?.ok === true)

  // Login with new password
  const r2 = await req('POST', '/api/auth/login', {
    handle: 'alice_auth_test',
    password: 'newSecurePass789',
  })
  ok('New password works', r2.s === 200)

  // Old password rejected
  const r3 = await req('POST', '/api/auth/login', {
    handle: 'alice_auth_test',
    password: 'password123',
  })
  ok('Old password rejected', r3.s === 401)
}

async function testUserList() {
  console.log('\n🔷 Auth: User List + Second User')

  // Register bob
  const r1 = await req('POST', '/api/auth/register', {
    handle: 'bob_auth_test',
    password: 'password123',
    displayName: 'Bob Auth',
  })
  ok('Bob registers → 201', r1.s === 201)
  const bobToken = r1.b?.token

  // List users (requires auth)
  const r2 = await req('GET', '/api/auth/users', null, bobToken)
  ok('User list → 200', r2.s === 200)

  // Handle both possible response shapes
  const users = Array.isArray(r2.b) ? r2.b
    : Array.isArray(r2.b?.users) ? r2.b.users
    : Array.isArray(r2.b?.items) ? r2.b.items
    : []
  ok('Has at least 2 users', users.length >= 2)
  ok('No passwords leaked', !users.some(u => u.passwordHash || u.passwordSalt))
}

async function testValidationErrors() {
  console.log('\n🔷 Auth: Input Validation Errors')

  // Missing displayName
  const r1 = await req('POST', '/api/auth/register', {
    handle: 'validhandle99', password: 'pass123',
  })
  ok('Missing displayName → 400', r1.s === 400)

  // Missing handle
  const r2 = await req('POST', '/api/auth/register', {
    password: 'pass123', displayName: 'No Handle',
  })
  ok('Missing handle → 400', r2.s === 400)

  // Password too short (< 6 chars)
  const r3 = await req('POST', '/api/auth/register', {
    handle: 'shortpassuser', password: '12', displayName: 'Short Pass',
  })
  ok('Password too short → 400', r3.s === 400)

  // Missing login fields
  const r4 = await req('POST', '/api/auth/login', { handle: 'alice_auth_test' })
  ok('Login missing password → 400', r4.s === 400)
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

async function runTests(externalHubUrl) {
  if (externalHubUrl) HUB_URL = externalHubUrl

  passed = 0
  failed = 0

  let aliceToken = null
  try {
    aliceToken = await testRegisterAndLogin()
    await testGetMe(aliceToken)
    await testDuplicateRegister()
    await testWrongPassword()
    await testProfileUpdate(aliceToken)
    await testHandleAvailability()
    await testChangePassword(aliceToken)
    await testUserList()
    await testValidationErrors()
  } catch (err) {
    console.error('\n💥 Auth test error:', err.message)
    failed++
  }

  return { passed, failed }
}

// Standalone execution
if (require.main === module) {
  ;(async () => {
    const port = await findFreePort()
    HUB_URL = `http://localhost:${port}`
    await startHub(port)
    const { passed: p, failed: f } = await runTests()
    if (hubProcess) hubProcess.kill()
    console.log(`\n📊 Auth Tests: ${p} passed, ${f} failed`)
    process.exit(f > 0 ? 1 : 0)
  })().catch(err => {
    console.error('Fatal:', err)
    if (hubProcess) hubProcess.kill()
    process.exit(1)
  })
}

module.exports = { runTests }
