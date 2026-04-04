/**
 * User Authentication Routes
 *
 * POST /api/auth/register        — 注册（若 Hub 开启 requireInvite，需要邀请码）
 * POST /api/auth/login           — 登录
 * GET  /api/auth/me              — 当前用户 (JWT Bearer)
 * PATCH /api/auth/profile        — 更新资料 (JWT Bearer)
 * POST /api/auth/change-password — 修改密码 (JWT Bearer)
 * POST /api/auth/check-handle    — 检查 @handle 可用性 (无需认证)
 * GET  /api/auth/users           — 用户列表 (JWT Bearer, admin only)
 * POST /api/auth/invite          — 生成邀请码 (CEO/admin only)
 */

import { Router, Request, Response } from 'express'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { userStore } from '../store/users'

const router = Router()

// ─── Paths ────────────────────────────────────────────────────────────────────

const HUB_DIR     = path.join(process.env.HOME ?? '~', '.jackclaw', 'hub')
const INVITES_FILE = path.join(HUB_DIR, 'invites.json')
const HUB_CONFIG_FILE = path.join(HUB_DIR, 'config.json')

// ─── Hub Config ───────────────────────────────────────────────────────────────

interface HubConfig {
  requireInvite: boolean
  admins: string[]      // handles (without @) allowed to generate invites
}

function getHubConfig(): HubConfig {
  try {
    if (fs.existsSync(HUB_CONFIG_FILE)) {
      return { requireInvite: false, admins: [], ...JSON.parse(fs.readFileSync(HUB_CONFIG_FILE, 'utf-8')) } as HubConfig
    }
  } catch { /* ignore */ }
  return { requireInvite: false, admins: [] }
}

// ─── Invite Store ─────────────────────────────────────────────────────────────

interface InviteRecord {
  code: string
  createdBy: string   // handle of the admin who created it
  createdAt: number
  usedBy?: string     // handle of user who consumed it
  usedAt?: number
}

function loadInvites(): Record<string, InviteRecord> {
  try {
    if (fs.existsSync(INVITES_FILE)) {
      return JSON.parse(fs.readFileSync(INVITES_FILE, 'utf-8')) as Record<string, InviteRecord>
    }
  } catch { /* ignore */ }
  return {}
}

function saveInvites(invites: Record<string, InviteRecord>): void {
  fs.mkdirSync(path.dirname(INVITES_FILE), { recursive: true })
  fs.writeFileSync(INVITES_FILE, JSON.stringify(invites, null, 2), 'utf-8')
}

function generateInviteCode(): string {
  // 6-char alphanumeric, URL-safe, easy to share
  return crypto.randomBytes(12).toString('base64url').slice(0, 12).toUpperCase()
}

/**
 * Validate and consume an invite code.
 * Returns true if used successfully, false if code is invalid/already used.
 */
function consumeInvite(code: string, handle: string): boolean {
  const invites = loadInvites()
  const record  = invites[code.toUpperCase()]
  if (!record || record.usedBy) return false
  record.usedBy = handle
  record.usedAt = Date.now()
  saveInvites(invites)
  return true
}

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Extract authenticated handle from Bearer JWT, or null */
function authedHandle(req: Request): string | null {
  const user = userStore.validateToken(
    (req.headers.authorization ?? '').replace(/^Bearer /, ''),
  )
  return user?.handle ?? null
}

function asyncRoute(
  fn: (req: Request, res: Response) => Promise<void>,
) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err: Error & { status?: number }) => {
      res.status(err.status ?? 500).json({ error: err.message ?? 'Internal error' })
    })
  }
}

// ─── Public: no JWT required ──────────────────────────────────────────────────

// POST /api/auth/register
router.post('/register', asyncRoute(async (req, res) => {
  const { handle, password, displayName, email, inviteCode } = req.body ?? {}
  if (!handle || !password || !displayName) {
    res.status(400).json({ error: '缺少必填字段：handle、password、displayName' })
    return
  }

  const config = getHubConfig()

  if (config.requireInvite) {
    if (!inviteCode || typeof inviteCode !== 'string') {
      res.status(403).json({ error: 'invite_required', message: '此 Hub 需要邀请码才能注册' })
      return
    }
    const invites = loadInvites()
    const record  = invites[String(inviteCode).toUpperCase()]
    if (!record) {
      res.status(403).json({ error: 'invalid_invite', message: '邀请码无效' })
      return
    }
    if (record.usedBy) {
      res.status(403).json({ error: 'invite_used', message: '邀请码已被使用' })
      return
    }
  }

  const normalizedHandle = userStore.normalizeHandle(String(handle))
  const result = await userStore.register(
    String(handle), String(password), String(displayName), email ? String(email) : undefined,
  )

  // Consume the invite only after successful registration
  if (config.requireInvite && inviteCode) {
    consumeInvite(String(inviteCode), normalizedHandle)
  }

  res.status(201).json(result)
}))

// POST /api/auth/login
router.post('/login', asyncRoute(async (req, res) => {
  const { handle, password } = req.body ?? {}
  if (!handle || !password) {
    res.status(400).json({ error: '请输入 handle 和密码' })
    return
  }
  const result = await userStore.login(String(handle), String(password))
  res.json(result)
}))

// POST /api/auth/check-handle
router.post('/check-handle', (req: Request, res: Response) => {
  const { handle } = req.body ?? {}
  if (!handle) {
    res.status(400).json({ error: '缺少 handle 字段' })
    return
  }
  const normalized = userStore.normalizeHandle(String(handle))
  if (normalized.length < 3) {
    res.json({ available: false, reason: 'handle 至少 3 个字符' })
    return
  }
  res.json({ available: userStore.isHandleAvailable(normalized), handle: normalized })
})

// ─── Protected: JWT required ──────────────────────────────────────────────────

// GET /api/auth/me
router.get('/me', (req: Request, res: Response) => {
  const handle = authedHandle(req)
  if (!handle) { res.status(401).json({ error: '未登录或 token 无效' }); return }
  const user = userStore.getUser(handle)
  if (!user) { res.status(404).json({ error: '用户不存在' }); return }
  res.json(user)
})

// PATCH /api/auth/profile
router.patch('/profile', (req: Request, res: Response) => {
  const handle = authedHandle(req)
  if (!handle) { res.status(401).json({ error: '未登录或 token 无效' }); return }
  try {
    const { displayName, bio, avatar, email } = req.body ?? {}
    const updated = userStore.updateProfile(handle, { displayName, bio, avatar, email })
    res.json(updated)
  } catch (err: unknown) {
    const e = err as Error & { status?: number }
    res.status(e.status ?? 500).json({ error: e.message })
  }
})

// POST /api/auth/change-password
router.post('/change-password', asyncRoute(async (req, res) => {
  const handle = authedHandle(req)
  if (!handle) { res.status(401).json({ error: '未登录或 token 无效' }); return }
  const { oldPassword, newPassword } = req.body ?? {}
  if (!oldPassword || !newPassword) {
    res.status(400).json({ error: '缺少 oldPassword 或 newPassword' })
    return
  }
  await userStore.changePassword(handle, String(oldPassword), String(newPassword))
  res.json({ ok: true })
}))

// GET /api/auth/users  (简单分页列表 — admin only)
router.get('/users', (req: Request, res: Response) => {
  const handle = authedHandle(req)
  if (!handle) { res.status(401).json({ error: '未登录或 token 无效' }); return }
  const config = getHubConfig()
  if (config.admins.length > 0 && !config.admins.includes(handle)) {
    res.status(403).json({ error: 'admin_only' }); return
  }
  const page  = Math.max(1, parseInt(String(req.query.page  ?? '1'),  10))
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10)))
  res.json(userStore.listUsers(page, limit))
})

// POST /api/auth/invite — 生成邀请码 (CEO/admin only)
router.post('/invite', asyncRoute(async (req, res) => {
  const handle = authedHandle(req)
  if (!handle) { res.status(401).json({ error: '未登录或 token 无效' }); return }

  const config = getHubConfig()
  // Must be listed in admins array (or admins list is empty → any user can generate, for dev mode)
  if (config.admins.length > 0 && !config.admins.includes(handle)) {
    res.status(403).json({ error: 'admin_only', message: '只有管理员可以生成邀请码' })
    return
  }

  const { count = 1 } = req.body ?? {}
  const batchSize = Math.min(Math.max(1, parseInt(String(count), 10)), 50)

  const invites  = loadInvites()
  const codes: string[] = []

  for (let i = 0; i < batchSize; i++) {
    let code: string
    // Ensure uniqueness
    do { code = generateInviteCode() } while (invites[code])
    const record: InviteRecord = { code, createdBy: handle, createdAt: Date.now() }
    invites[code] = record
    codes.push(code)
  }

  saveInvites(invites)
  console.log(`[auth] ${handle} generated ${batchSize} invite code(s)`)
  res.status(201).json({ codes, count: codes.length })
}))

export default router
