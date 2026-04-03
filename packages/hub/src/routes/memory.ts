// Hub Memory Routes

import { Router } from 'express'
import { randomUUID as nanoid } from 'crypto'
import type { MemoryEntry } from '@jackclaw/memory'
import {
  broadcastMemory,
  getOrgMemories,
  registerNodeSkills,
  findExpertsBySkill,
  createCollabSession,
  syncCollabSession,
  endCollabSession,
} from '../store/memory.js'

const router = Router()

// GET /memory/org — 获取 org L3 记忆列表
router.get('/org', (_req, res) => {
  res.json({ entries: getOrgMemories() })
})

// POST /memory/broadcast — 节点广播记忆到 org
router.post('/broadcast', (req, res) => {
  const entry = req.body as MemoryEntry
  if (!entry?.id || !entry?.content) {
    res.status(400).json({ error: 'Invalid memory entry' })
    return
  }
  broadcastMemory(entry)
  res.json({ ok: true })
})

// POST /memory/skills — 节点注册技能
router.post('/skills', (req, res) => {
  const { nodeId, name, skills } = req.body as {
    nodeId: string
    name: string
    skills: string[]
  }
  if (!nodeId || !Array.isArray(skills)) {
    res.status(400).json({ error: 'nodeId and skills[] required' })
    return
  }
  registerNodeSkills(nodeId, name ?? nodeId, skills)
  res.json({ ok: true })
})

// GET /memory/experts?skill=xxx — 查找有某技能的节点
router.get('/experts', (req, res) => {
  const skill = req.query['skill'] as string
  if (!skill) {
    res.status(400).json({ error: 'skill query param required' })
    return
  }
  res.json({ experts: findExpertsBySkill(skill) })
})

// POST /memory/collab/init — 发起协作会话
router.post('/collab/init', (req, res) => {
  const { initiatorId, peerId, intent, topic } = req.body as {
    initiatorId: string
    peerId: string
    intent: string
    topic?: string
  }
  if (!initiatorId || !peerId) {
    res.status(400).json({ error: 'initiatorId and peerId required' })
    return
  }
  const sessionId = nanoid()
  createCollabSession({
    id: sessionId,
    intent: (intent ?? 'collaborate') as 'collaborate' | 'learn' | 'teach',
    initiatorId,
    peerId,
    topic,
    status: 'active',
    startedAt: Date.now(),
    entries: [],
  })
  res.json({ sessionId })
})

// POST /memory/collab/:id/sync — 同步协作记忆
router.post('/collab/:id/sync', (req, res) => {
  const { id } = req.params
  const { entries } = req.body as { entries: MemoryEntry[] }
  if (!Array.isArray(entries)) {
    res.status(400).json({ error: 'entries[] required' })
    return
  }
  syncCollabSession(id, entries)
  res.json({ ok: true })
})

// POST /memory/collab/:id/end — 结束协作，返回对方条目
router.post('/collab/:id/end', (req, res) => {
  const { id } = req.params
  const { mode } = req.body as { mode: string }
  const session = endCollabSession(id, mode ?? 'discard')
  if (!session) {
    res.status(404).json({ error: 'Session not found' })
    return
  }
  res.json({ entries: session.entries })
})

export default router
