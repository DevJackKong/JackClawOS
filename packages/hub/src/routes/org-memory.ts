// Hub routes - OrgMemory API
// GET  /api/org-memory  — 查询（?type=decision&limit=10）
// POST /api/org-memory  — 写入（需要 JWT，role=ceo 或 manager）

import { Router, Request, Response } from 'express'
import { OrgMemoryStore, OrgMemoryType } from '../store/org-memory'
import type { JWTPayload } from '../types'

const store = new OrgMemoryStore()
const router = Router()

/**
 * GET /api/org-memory
 * Query: ?type=decision&limit=10
 * Returns: { entries: OrgMemoryEntry[] }
 */
router.get('/', (_req: Request, res: Response): void => {
  const type = (_req.query.type as OrgMemoryType) || undefined
  const limit = Math.min(parseInt((_req.query.limit as string) || '20', 10), 100)

  const entries = store.query(type, limit)
  res.json({ success: true, total: entries.length, entries })
})

/**
 * POST /api/org-memory
 * Body: { type, content, tags? }
 * Requires JWT role = ceo or manager
 * Returns: { entry: OrgMemoryEntry }
 */
router.post('/', (req: Request, res: Response): void => {
  const payload = (req as Request & { jwtPayload?: JWTPayload }).jwtPayload
  const role = payload?.role ?? ''

  if (role !== 'ceo' && role !== 'manager') {
    res.status(403).json({ error: 'Write access denied. CEO or manager role required.' })
    return
  }

  const { type, content, tags } = req.body as {
    type?: OrgMemoryType
    content?: string
    tags?: string[]
  }

  const validTypes: OrgMemoryType[] = ['decision', 'project', 'lesson', 'reference', 'norm']
  if (!type || !validTypes.includes(type)) {
    res.status(400).json({ error: `Missing or invalid type. Must be one of: ${validTypes.join(', ')}` })
    return
  }
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    res.status(400).json({ error: 'content is required' })
    return
  }

  const entry = store.add({
    type,
    content: content.trim(),
    author: payload!.nodeId,
    tags: Array.isArray(tags) ? tags : undefined,
  })

  res.status(201).json({ success: true, entry })
})

export default router
