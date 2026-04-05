#!/usr/bin/env node
/**
 * JackClaw Hub Auth E2E Integration Test
 *
 * 验证完整用户认证链路：
 *   注册 → 登录 → 获取当前用户 → 更新资料 → 修改密码 → 新密码重新登录
 *
 * Usage: node tests/auth-e2e.mjs
 */

import http from 'http'
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'

const HUB_PORT  = 3198
const HUB_URL   = `http://localhost:${HUB_PORT}`
const TIMEOUT_MS = 30_000

// Unique handle prevents conflicts across runs
const TEST_HANDLE       = `testauth${Date.now()}`
const TEST_PASSWORD     = 'test123'
const TEST_NEW_PASSWORD = 'newpass456'
const TEST_DISPLAY_NAME = 'Test User'
const TEST_BIO          = 'E2E test bio'

const HUB_DIR        = path.join(process.env.HOME ?? '~', '.jackclaw', 'hub')
const USERS_FILE     = path.join(HUB_DIR, 'users.json')
const DIRECTORY_FILE = path.join(HUB_DIR, 'directory.json')

let hubProcess = null

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(tag, msg) {
  const ts = new Date().toISOString().slice(11, 23)
  console.log(`[${ts}] [${tag}] ${msg}`)
}

function pass(msg) {
  console.log(`  ✅ ${msg}`)
}

function fail(msg) {
  console.error(`\n❌ FAIL: ${msg}`)
  doCleanup().finally(() => process.exit(1))
}

async function doCleanup() {
  log('cleanup', `Removing test user @${TEST_HANDLE}...`)
  try {
    if (fs.existsSync(USERS_FILE)) {
      const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'))
      if (users[TEST_HANDLE]) {
        delete users[TEST_HANDLE]
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8')
        log('cleanup', 'Removed from users.json')
      }
    }
  } catch (e) {
    log('cleanup:warn', `users.json cleanup: ${e.message}`)
  }
  try {
    if (fs.existsSync(DIRECTORY_FILE)) {
      const dir = JSON.parse(fs.readFileSync(DIRECTORY_FILE, 'utf-8'))
      const key = `@${TEST_HANDLE}`
      if (dir[key]) {
        delete dir[key]
        fs.writeFileSync(DIRECTORY_FILE, JSON.stringify(dir, null, 2), 'utf-8')
        log('cleanup', 'Removed from directory.json')
      }
    }
  } catch (e) {
    log('cleanup:warn', `directory.json cleanup: ${e.message}`)
  }
  if (hubProcess) {
    hubProcess.kill('SIGTERM')
    await new Promise(r => setTimeout(r, 500))
    if (!hubProcess.killed) hubProcess.kill('SIGKILL')
    log('cleanup', 'Hub process killed')
  }
}

function request(method, url, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const u = new URL(url)
    const headers = { 'Content-Type': 'application/json' }
    if (data) headers['Content-Length'] = Buffer.byteLength(data)
    if (token) headers['Authorization'] = `Bearer ${token}`

    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers },
      (res) => {
        let buf = ''
        res.on('data', c => buf += c)
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(buf) }) }
          catch { resolve({ status: res.statusCode, body: buf }) }
        })
      },
    )
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

const post  = (url, body, token) => request('POST',  url, body, token)
const get   = (url, token)       => request('GET',   url, null, token)
const patch = (url, body, token) => request('PATCH', url, body, token)

function waitFor(ms) { return new Promise(r => setTimeout(r, ms)) }

async function waitForPort(port, timeoutMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await get(`http://localhost:${port}/health`)
      if (res.status === 200) return true
    } catch {}
    await waitFor(300)
  }
  return false
}

// ─── Steps ────────────────────────────────────────────────────────────────────

async function step1_startHub() {
  log('step1', `Starting Hub on port ${HUB_PORT}`)

  hubProcess = spawn('node', ['packages/hub/dist/index.js'], {
    cwd: process.cwd(),
    env: { ...process.env, HUB_PORT: String(HUB_PORT), NODE_ENV: 'test' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  hubProcess.stdout.on('data', d => { const l = d.toString().trim(); if (l) log('hub', l) })
  hubProcess.stderr.on('data', d => { const l = d.toString().trim(); if (l) log('hub:err', l) })
  hubProcess.on('exit', code => log('hub', `Process exited (${code})`))

  const ready = await waitForPort(HUB_PORT)
  if (!ready) return fail('Hub did not start within 15s')
  pass('Hub started and healthy')
}

async function step2_register() {
  log('step2', `POST /api/auth/register  handle=${TEST_HANDLE}`)
  const res = await post(`${HUB_URL}/api/auth/register`, {
    handle: TEST_HANDLE,
    password: TEST_PASSWORD,
    displayName: TEST_DISPLAY_NAME,
  })

  if (res.status !== 201) return fail(`register: expected 201, got ${res.status} — ${JSON.stringify(res.body)}`)
  if (!res.body.token)    return fail('register: no token in response')
  if (res.body.user?.handle !== TEST_HANDLE) return fail(`register: wrong handle: ${res.body.user?.handle}`)
  if (res.body.user?.passwordHash !== undefined) return fail('register: passwordHash leaked in response')

  pass(`Registered @${TEST_HANDLE}, got JWT`)
  return res.body.token
}

async function step3_login() {
  log('step3', 'POST /api/auth/login')
  const res = await post(`${HUB_URL}/api/auth/login`, {
    handle: TEST_HANDLE,
    password: TEST_PASSWORD,
  })

  if (res.status !== 200) return fail(`login: expected 200, got ${res.status} — ${JSON.stringify(res.body)}`)
  if (!res.body.token)    return fail('login: no token')
  if (res.body.user?.handle !== TEST_HANDLE) return fail(`login: wrong handle: ${res.body.user?.handle}`)

  pass(`Logged in as @${TEST_HANDLE}`)
  return res.body.token
}

async function step4_me(token) {
  log('step4', 'GET /api/auth/me')
  const res = await get(`${HUB_URL}/api/auth/me`, token)

  if (res.status !== 200) return fail(`/me: expected 200, got ${res.status} — ${JSON.stringify(res.body)}`)
  if (res.body.handle !== TEST_HANDLE) return fail(`/me: wrong handle: ${res.body.handle}`)
  if (res.body.displayName !== TEST_DISPLAY_NAME) return fail(`/me: wrong displayName: ${res.body.displayName}`)
  if (res.body.passwordHash !== undefined) return fail('/me: passwordHash leaked')

  pass(`/me returned correct user: @${res.body.handle} "${res.body.displayName}"`)
}

async function step5_updateProfile(token) {
  log('step5', 'PATCH /api/auth/profile')
  const newName = 'Updated Test User'
  const res = await patch(`${HUB_URL}/api/auth/profile`, {
    displayName: newName,
    bio: TEST_BIO,
  }, token)

  if (res.status !== 200) return fail(`profile: expected 200, got ${res.status} — ${JSON.stringify(res.body)}`)
  if (res.body.displayName !== newName) return fail(`profile: displayName not updated: ${res.body.displayName}`)
  if (res.body.bio !== TEST_BIO) return fail(`profile: bio not updated: ${res.body.bio}`)

  pass(`Profile updated: displayName="${res.body.displayName}", bio="${res.body.bio}"`)

  // Verify via /me
  const meRes = await get(`${HUB_URL}/api/auth/me`, token)
  if (meRes.body.displayName !== newName) return fail(`profile: /me still shows old displayName`)
  pass('Profile change confirmed via /me')
}

async function step6_changePassword(token) {
  log('step6', 'POST /api/auth/change-password')
  const res = await post(`${HUB_URL}/api/auth/change-password`, {
    oldPassword: TEST_PASSWORD,
    newPassword: TEST_NEW_PASSWORD,
  }, token)

  if (res.status !== 200) return fail(`change-password: expected 200, got ${res.status} — ${JSON.stringify(res.body)}`)
  if (!res.body.ok) return fail(`change-password: body.ok is not true: ${JSON.stringify(res.body)}`)

  pass('Password changed successfully')
}

async function step6b_rejectOldPassword() {
  log('step6b', 'Verify old password is rejected')
  const res = await post(`${HUB_URL}/api/auth/login`, {
    handle: TEST_HANDLE,
    password: TEST_PASSWORD,
  })
  if (res.status !== 401) return fail(`old password should be rejected (401), got ${res.status}`)
  pass('Old password correctly rejected (401)')
}

async function step7_loginNewPassword() {
  log('step7', 'POST /api/auth/login with new password')
  const res = await post(`${HUB_URL}/api/auth/login`, {
    handle: TEST_HANDLE,
    password: TEST_NEW_PASSWORD,
  })

  if (res.status !== 200) return fail(`re-login: expected 200, got ${res.status} — ${JSON.stringify(res.body)}`)
  if (!res.body.token) return fail('re-login: no token')
  if (res.body.user?.handle !== TEST_HANDLE) return fail(`re-login: wrong handle: ${res.body.user?.handle}`)

  pass('Re-login with new password succeeded')
  return res.body.token
}

async function step8_meWithNewToken(token) {
  log('step8', 'GET /api/auth/me with fresh token')
  const res = await get(`${HUB_URL}/api/auth/me`, token)
  if (res.status !== 200) return fail(`/me (new token): expected 200, got ${res.status}`)
  if (res.body.handle !== TEST_HANDLE) return fail(`/me (new token): wrong handle`)
  pass('JWT from new login is valid')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔐 JackClaw Hub Auth E2E Test')
  console.log('━'.repeat(50))
  console.log(`   handle:   @${TEST_HANDLE}`)
  console.log(`   port:     ${HUB_PORT}`)
  console.log('━'.repeat(50))

  const globalTimer = setTimeout(() => fail(`Global timeout (${TIMEOUT_MS / 1000}s)`), TIMEOUT_MS)

  try {
    await step1_startHub()

    const registerToken  = await step2_register()
    const loginToken     = await step3_login()

    // Use the login token (not register token) to prove login works independently
    await step4_me(loginToken)
    await step5_updateProfile(loginToken)
    await step6_changePassword(loginToken)
    await step6b_rejectOldPassword()

    const newToken = await step7_loginNewPassword()
    await step8_meWithNewToken(newToken)

    clearTimeout(globalTimer)
    console.log('\n' + '━'.repeat(50))
    console.log('🎉 ALL AUTH TESTS PASSED — 用户认证链路验证成功！')
    console.log('━'.repeat(50))
  } catch (err) {
    clearTimeout(globalTimer)
    fail(err.message ?? String(err))
  } finally {
    await doCleanup()
  }
}

main()
