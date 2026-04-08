/**
 * Skills & Reflexion Hub Routes
 *
 * GET  /api/skills              — 查看所有技能
 * GET  /api/skills/search?q=    — 搜索技能
 * POST /api/skills/share        — 共享技能到 Hub
 * GET  /api/skills/stats        — 技能统计
 * GET  /api/reflexion            — 查看反思记录
 * GET  /api/reflexion/stats      — 反思统计
 */

import { Router } from 'express'
import type { Request, Response } from 'express'
import fs from 'fs'
import path from 'path'
import os from 'os'

const router = Router()

// ─── Input sanitization ──────────────────────────────────────────────────────
const SAFE_ID_RE = /^[a-zA-Z0-9._@-]{1,128}$/

/** Validate nodeId to prevent path traversal */
function sanitizeNodeId(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!SAFE_ID_RE.test(trimmed)) return null
  // Double-check no path separators
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) return null
  return trimmed
}

// ─── 共享技能存储（Hub 级别）──────────────────────────────────────────────────

const HUB_SKILLS_PATH = path.join(os.homedir(), '.jackclaw', 'hub-skills.json')

interface SharedSkill {
  id: string
  name: string
  description: string
  code: string
  tags: string[]
  successRate: number
  usageCount: number
  sharedBy: string  // nodeId
  sharedAt: number
}

function loadSharedSkills(): SharedSkill[] {
  if (!fs.existsSync(HUB_SKILLS_PATH)) return []
  try {
    return JSON.parse(fs.readFileSync(HUB_SKILLS_PATH, 'utf-8'))
  } catch { return [] }
}

function saveSharedSkills(skills: SharedSkill[]): void {
  fs.writeFileSync(HUB_SKILLS_PATH, JSON.stringify(skills, null, 2))
}

// ─── Skill Routes ────────────────────────────────────────────────────────────

/**
 * GET /api/skills — 列出所有共享技能
 */
router.get('/skills', (_req: Request, res: Response) => {
  const skills = loadSharedSkills()
  res.json({
    total: skills.length,
    skills: skills.map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
      tags: s.tags,
      successRate: s.successRate,
      usageCount: s.usageCount,
      sharedBy: s.sharedBy,
      sharedAt: s.sharedAt,
    })),
  })
})

/**
 * GET /api/skills/search?q=xxx — 搜索技能
 */
router.get('/skills/search', (req: Request, res: Response) => {
  const query = String(req.query.q || '').toLowerCase()
  if (!query) {
    res.status(400).json({ error: 'Missing query parameter q' })
    return
  }

  const skills = loadSharedSkills()
  const results = skills
    .map(s => {
      const text = `${s.name} ${s.description} ${s.tags.join(' ')}`.toLowerCase()
      const words = query.split(/\s+/)
      const score = words.filter(w => text.includes(w)).length / words.length
      return { ...s, relevance: score }
    })
    .filter(s => s.relevance > 0.2)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 10)

  res.json({ query, results })
})

/**
 * GET /api/skills/stats — 技能统计
 */
router.get('/skills/stats', (_req: Request, res: Response) => {
  const skills = loadSharedSkills()
  const tagCount = new Map<string, number>()
  let totalRate = 0

  for (const s of skills) {
    totalRate += s.successRate
    for (const t of s.tags) tagCount.set(t, (tagCount.get(t) || 0) + 1)
  }

  res.json({
    totalSkills: skills.length,
    avgSuccessRate: skills.length ? totalRate / skills.length : 0,
    topTags: Array.from(tagCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count })),
    topContributors: Array.from(
      skills.reduce((m, s) => m.set(s.sharedBy, (m.get(s.sharedBy) || 0) + 1), new Map<string, number>())
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([nodeId, count]) => ({ nodeId, count })),
  })
})

/**
 * GET /api/skills/:id — 获取技能详情（含 code）
 */
router.get('/skills/:id', (req: Request, res: Response) => {
  const skills = loadSharedSkills()
  const skill = skills.find(s => s.id === req.params.id)
  if (!skill) {
    res.status(404).json({ error: 'Skill not found' })
    return
  }
  res.json(skill)
})

/**
 * POST /api/skills/share — 共享技能到 Hub
 * Body: { nodeId, skills: [{ name, description, code, tags, successRate, usageCount }] }
 */
router.post('/skills/share', (req: Request, res: Response) => {
  const { nodeId: rawNodeId, skills } = req.body
  if (!rawNodeId || !Array.isArray(skills)) {
    res.status(400).json({ error: 'Missing nodeId or skills array' })
    return
  }

  const nodeId = sanitizeNodeId(rawNodeId)
  if (!nodeId) {
    res.status(400).json({ error: 'Invalid nodeId format' })
    return
  }

  const existing = loadSharedSkills()
  let added = 0

  for (const s of skills) {
    // 去重：同 nodeId + 同名 = 更新
    const idx = existing.findIndex(e => e.sharedBy === nodeId && e.name === s.name)
    const shared: SharedSkill = {
      id: s.id || `skill-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: s.name,
      description: s.description,
      code: s.code,
      tags: s.tags || [],
      successRate: s.successRate ?? 1,
      usageCount: s.usageCount ?? 0,
      sharedBy: nodeId,
      sharedAt: Date.now(),
    }

    if (idx >= 0) {
      existing[idx] = shared
    } else {
      existing.push(shared)
      added++
    }
  }

  saveSharedSkills(existing)
  res.json({ status: 'ok', added, total: existing.length })
})

// ─── Reflexion Routes ────────────────────────────────────────────────────────

const REFLEXION_DIR = path.join(os.homedir(), '.jackclaw', 'reflexion')

/**
 * GET /api/reflexion?nodeId=xxx&limit=20 — 查看反思记录
 */
router.get('/reflexion', (req: Request, res: Response) => {
  const rawNodeId = String(req.query.nodeId || '')
  const limit = Math.min(Number(req.query.limit) || 20, 100)

  if (!rawNodeId) {
    // 列出所有节点
    if (!fs.existsSync(REFLEXION_DIR)) {
      res.json({ nodes: [] })
      return
    }
    const nodes = fs.readdirSync(REFLEXION_DIR).filter(f =>
      fs.statSync(path.join(REFLEXION_DIR, f)).isDirectory()
    )
    res.json({ nodes })
    return
  }

  const nodeId = sanitizeNodeId(rawNodeId)
  if (!nodeId) {
    res.status(400).json({ error: 'Invalid nodeId format' })
    return
  }

  const filePath = path.join(REFLEXION_DIR, nodeId, 'reflexions.json')
  if (!fs.existsSync(filePath)) {
    res.json({ nodeId, total: 0, entries: [] })
    return
  }

  try {
    const entries = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    res.json({
      nodeId,
      total: entries.length,
      entries: entries.slice(-limit).reverse(),
    })
  } catch {
    res.json({ nodeId, total: 0, entries: [] })
  }
})

/**
 * GET /api/reflexion/stats?nodeId=xxx — 反思统计
 */
router.get('/reflexion/stats', (req: Request, res: Response) => {
  const rawNodeId = String(req.query.nodeId || '')
  if (!rawNodeId) {
    res.status(400).json({ error: 'Missing nodeId' })
    return
  }

  const nodeId = sanitizeNodeId(rawNodeId)
  if (!nodeId) {
    res.status(400).json({ error: 'Invalid nodeId format' })
    return
  }

  const filePath = path.join(REFLEXION_DIR, nodeId, 'reflexions.json')
  if (!fs.existsSync(filePath)) {
    res.json({ nodeId, totalReflections: 0, avgScore: 0, successRate: 0, topLessons: [] })
    return
  }

  try {
    const entries = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Array<{
      success: boolean; score: number; lessonsLearned: string[]
    }>
    const total = entries.length
    const avgScore = total ? entries.reduce((s, e) => s + e.score, 0) / total : 0
    const successRate = total ? entries.filter(e => e.success).length / total : 0

    const lessonMap = new Map<string, number>()
    for (const e of entries) {
      for (const l of (e.lessonsLearned || [])) {
        lessonMap.set(l, (lessonMap.get(l) || 0) + 1)
      }
    }

    res.json({
      nodeId,
      totalReflections: total,
      avgScore: Math.round(avgScore),
      successRate: Math.round(successRate * 100) / 100,
      topLessons: Array.from(lessonMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([lesson, count]) => ({ lesson, count })),
    })
  } catch {
    res.json({ nodeId, totalReflections: 0 })
  }
})

export default router
