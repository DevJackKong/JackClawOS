/**
 * User Authentication Routes
 *
 * POST /api/auth/register        — 注册
 * POST /api/auth/login           — 登录
 * GET  /api/auth/me              — 当前用户 (JWT Bearer)
 * PATCH /api/auth/profile        — 更新资料 (JWT Bearer)
 * POST /api/auth/change-password — 修改密码 (JWT Bearer)
 * POST /api/auth/check-handle    — 检查 @handle 可用性 (无需认证)
 * GET  /api/auth/users           — 用户列表 (JWT Bearer, admin only)
 */

import { Router, Request, Response } from 'express'
import { userStore } from '../store/users'

const router = Router()

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
  const { handle, password, displayName, email } = req.body ?? {}
  if (!handle || !password || !displayName) {
    res.status(400).json({ error: '缺少必填字段：handle、password、displayName' })
    return
  }
  const result = await userStore.register(
    String(handle), String(password), String(displayName), email ? String(email) : undefined,
  )
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

// GET /api/auth/users  (简单分页列表)
router.get('/users', (req: Request, res: Response) => {
  const handle = authedHandle(req)
  if (!handle) { res.status(401).json({ error: '未登录或 token 无效' }); return }
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10))
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10)))
  res.json(userStore.listUsers(page, limit))
})

export default router
