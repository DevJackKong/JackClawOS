/**
 * JackClaw Hub - Agent Directory Routes
 *
 * /api/directory/register   - Register a @handle
 * /api/directory/lookup/:handle - Look up an agent by @handle
 * /api/directory/list       - List all public agents on this Hub
 *
 * /api/collab/invite        - Send a collaboration invitation
 * /api/collab/respond       - Accept/decline/conditional response
 * /api/collab/update        - Pause/end a collaboration session
 * /api/collab/sessions      - List active sessions for a node
 */

import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import {
  AgentProfile,
  HandleRegistration,
  CollaborationInvite,
  CollaborationResponse,
  CollaborationSession,
  TrustRelation,
  TrustLevel,
  parseHandle,
  formatHandle,
} from '@jackclaw/protocol'

const router = Router()

// ─── Storage ──────────────────────────────────────────────────────────────────

const HUB_DIR = path.join(process.env.HOME || '~', '.jackclaw', 'hub')
const DIRECTORY_FILE = path.join(HUB_DIR, 'directory.json')
const COLLABS_FILE = path.join(HUB_DIR, 'collaborations.json')
const TRUST_FILE = path.join(HUB_DIR, 'trust.json')

function loadJSON<T>(file: string, defaultVal: T): T {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8')) as T
  } catch { /* ignore */ }
  return defaultVal
}

function saveJSON(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
}

// In-memory caches
let directory: Record<string, AgentProfile> = loadJSON(DIRECTORY_FILE, {})
let collaborations: Record<string, CollaborationSession> = loadJSON(COLLABS_FILE, {})
let trustGraph: Record<string, TrustRelation> = loadJSON(TRUST_FILE, {})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function trustKey(from: string, to: string): string {
  return `${from}→${to}`
}

function getTrust(from: string, to: string): TrustRelation | null {
  return trustGraph[trustKey(from, to)] ?? null
}

function setTrust(rel: TrustRelation): void {
  trustGraph[trustKey(rel.fromHandle, rel.toHandle)] = rel
  saveJSON(TRUST_FILE, trustGraph)
}

function shouldAutoAccept(fromHandle: string, toHandle: string): boolean {
  const trust = getTrust(toHandle, fromHandle)
  return trust?.level === 'trusted' || trust?.level === 'colleague'
}

// ─── Directory Routes ─────────────────────────────────────────────────────────

// POST /api/directory/register
router.post('/register', (req: Request, res: Response) => {
  const body = req.body as HandleRegistration & { nodeId: string }

  if (!body.handle || !body.nodeId || !body.publicKey) {
    return res.status(400).json({ error: 'missing_fields', required: ['handle', 'nodeId', 'publicKey'] })
  }

  const parsed = parseHandle(body.handle)
  if (!parsed) {
    return res.status(400).json({ error: 'invalid_handle', message: 'Handle must be alphanumeric, e.g. @alice or @alice.myorg' })
  }

  // Check uniqueness
  if (directory[parsed.full] && directory[parsed.full].nodeId !== body.nodeId) {
    return res.status(409).json({ error: 'handle_taken', handle: parsed.full })
  }

  const profile: AgentProfile = {
    nodeId: body.nodeId,
    handle: parsed.full,
    displayName: body.displayName ?? parsed.local,
    role: body.role ?? 'member',
    publicKey: body.publicKey,
    hubUrl: (req as any).hubUrl ?? `http://localhost:${process.env.HUB_PORT ?? 3100}`,
    capabilities: body.capabilities ?? [],
    visibility: body.visibility ?? 'contacts',
    createdAt: Date.now(),
    lastSeen: Date.now(),
  }

  directory[parsed.full] = profile
  saveJSON(DIRECTORY_FILE, directory)

  console.log(`[directory] Registered: ${parsed.full} (nodeId: ${body.nodeId})`)
  return res.status(201).json({ handle: parsed.full, profile })
})

// GET /api/directory/lookup/:handle
router.get('/lookup/:handle', (req: Request, res: Response) => {
  const raw = decodeURIComponent(req.params.handle)
  const parsed = parseHandle(raw)
  if (!parsed) return res.status(400).json({ error: 'invalid_handle' })

  const profile = directory[parsed.full]
  if (!profile) {
    return res.json({ found: false, handle: parsed.full, isLocal: true })
  }

  // Update lastSeen
  directory[parsed.full].lastSeen = Date.now()
  saveJSON(DIRECTORY_FILE, directory)

  // Don't expose private agents to unauthenticated callers
  if (profile.visibility === 'private') {
    return res.json({ found: false, handle: parsed.full, isLocal: true })
  }

  return res.json({ found: true, profile, isLocal: true })
})

// GET /api/directory/list
router.get('/list', (req: Request, res: Response) => {
  const visible = Object.values(directory).filter(p => p.visibility === 'public')
  return res.json({ agents: visible, count: visible.length })
})

// ─── Collaboration Routes ─────────────────────────────────────────────────────

// POST /api/collab/invite
router.post('/collab/invite', (req: Request, res: Response) => {
  const body = req.body as CollaborationInvite & { fromNodeId: string }

  if (!body.fromHandle || !body.toHandle || !body.topic) {
    return res.status(400).json({ error: 'missing_fields', required: ['fromHandle', 'toHandle', 'topic'] })
  }

  // Validate handles
  const fromParsed = parseHandle(body.fromHandle)
  const targets = body.toHandle.split(',').map(h => h.trim())
  if (!fromParsed) return res.status(400).json({ error: 'invalid_from_handle' })

  // Check all targets exist
  const missing = targets.filter(t => {
    const p = parseHandle(t)
    return !p || !directory[p.full]
  })
  if (missing.length > 0) {
    return res.status(404).json({ error: 'agent_not_found', missing })
  }

  const inviteId = crypto.randomUUID()
  const sessionId = crypto.randomUUID()

  const invite: CollaborationInvite = {
    inviteId,
    fromHandle: fromParsed.full,
    toHandle: targets.map(t => parseHandle(t)!.full).join(', '),
    sessionId,
    topic: body.topic,
    context: body.context,
    capabilities: body.capabilities,
    autoAccept: body.autoAccept ?? false,
    memoryScope: body.memoryScope ?? 'isolated',
    memoryClearOnEnd: body.memoryClearOnEnd ?? false,
    expiresAt: body.expiresAt,
    createdAt: Date.now(),
  }

  // Check if any target should auto-accept
  const autoAccepted = targets.filter(t => {
    const tp = parseHandle(t)!.full
    return shouldAutoAccept(fromParsed.full, tp) || body.autoAccept
  })

  const status = autoAccepted.length === targets.length ? 'accepted' : 'pending'

  const session: CollaborationSession = {
    sessionId,
    inviteId,
    participants: [fromParsed.full, ...targets.map(t => parseHandle(t)!.full)],
    initiatorHandle: fromParsed.full,
    topic: body.topic,
    status,
    memoryScope: invite.memoryScope,
    memoryClearOnEnd: invite.memoryClearOnEnd,
    startedAt: status === 'accepted' ? Date.now() : undefined,
  }

  collaborations[sessionId] = session
  saveJSON(COLLABS_FILE, collaborations)

  console.log(`[collab] Invite ${inviteId}: ${fromParsed.full} → ${invite.toHandle} (${status})`)

  return res.status(201).json({
    inviteId,
    sessionId,
    status,
    autoAccepted: autoAccepted.length > 0,
    session,
  })
})

// POST /api/collab/respond
router.post('/collab/respond', (req: Request, res: Response) => {
  const body = req.body as CollaborationResponse

  if (!body.inviteId || !body.fromHandle || !body.decision) {
    return res.status(400).json({ error: 'missing_fields' })
  }

  // Find session by inviteId
  const session = Object.values(collaborations).find(s => s.inviteId === body.inviteId)
  if (!session) return res.status(404).json({ error: 'invite_not_found' })

  const fromParsed = parseHandle(body.fromHandle)
  if (!fromParsed) return res.status(400).json({ error: 'invalid_handle' })

  // Update session status
  if (body.decision === 'accept') {
    session.status = 'accepted'
    session.startedAt = Date.now()
  } else if (body.decision === 'decline') {
    session.status = 'declined'
    session.endedAt = Date.now()
  } else if (body.decision === 'conditional') {
    session.status = 'conditional'
    session.conditions = body.conditions
    session.startedAt = Date.now()
  }

  collaborations[session.sessionId] = session
  saveJSON(COLLABS_FILE, collaborations)

  // Update trust relation
  const existing = getTrust(session.initiatorHandle, fromParsed.full)
  const newLevel: TrustLevel = body.decision === 'decline' ? 'contact'
    : existing?.collaborationCount ?? 0 >= 3 ? 'colleague'
    : 'contact'

  setTrust({
    fromHandle: session.initiatorHandle,
    toHandle: fromParsed.full,
    level: newLevel,
    collaborationCount: (existing?.collaborationCount ?? 0) + (body.decision !== 'decline' ? 1 : 0),
    successRate: existing?.successRate ?? 1.0,
    reputationScore: existing?.reputationScore ?? 70,
    establishedAt: existing?.establishedAt ?? Date.now(),
    lastInteractedAt: Date.now(),
  })

  console.log(`[collab] Response: ${fromParsed.full} ${body.decision} invite ${body.inviteId}`)

  return res.json({ sessionId: session.sessionId, status: session.status, session })
})

// PATCH /api/collab/sessions/:sessionId
router.patch('/collab/sessions/:sessionId', (req: Request, res: Response) => {
  const { sessionId } = req.params
  const { action, outcome } = req.body as { action: 'pause' | 'end' | 'resume', outcome?: string }

  const session = collaborations[sessionId]
  if (!session) return res.status(404).json({ error: 'session_not_found' })

  if (action === 'pause') {
    session.status = 'paused'
    session.pausedAt = Date.now()
  } else if (action === 'resume') {
    session.status = 'accepted'
    session.pausedAt = undefined
  } else if (action === 'end') {
    session.status = 'ended'
    session.endedAt = Date.now()
    session.outcome = outcome

    // If teaching memory, flag for cleanup
    if (session.memoryClearOnEnd && session.memoryScope === 'teaching') {
      console.log(`[collab] Teaching session ${sessionId} ended — memory clear scheduled`)
      // Memory module will pick this up via event
    }

    // Update trust scores for all participants
    session.participants.forEach(p1 => {
      session.participants.filter(p2 => p2 !== p1).forEach(p2 => {
        const existing = getTrust(p1, p2)
        const successDelta = outcome ? 0.05 : 0  // slight boost if outcome recorded
        setTrust({
          fromHandle: p1,
          toHandle: p2,
          level: existing?.level ?? 'contact',
          collaborationCount: (existing?.collaborationCount ?? 0) + 1,
          successRate: Math.min(1.0, (existing?.successRate ?? 0.8) + successDelta),
          reputationScore: Math.min(100, (existing?.reputationScore ?? 70) + (outcome ? 2 : 0)),
          establishedAt: existing?.establishedAt ?? Date.now(),
          lastInteractedAt: Date.now(),
        })
      })
    })
  }

  collaborations[sessionId] = session
  saveJSON(COLLABS_FILE, collaborations)

  return res.json({ sessionId, status: session.status, session })
})

// GET /api/collab/sessions
router.get('/collab/sessions', (req: Request, res: Response) => {
  const { handle, status } = req.query as { handle?: string, status?: string }

  let sessions = Object.values(collaborations)

  if (handle) {
    const parsed = parseHandle(handle)
    if (parsed) {
      sessions = sessions.filter(s => s.participants.includes(parsed.full))
    }
  }

  if (status) {
    sessions = sessions.filter(s => s.status === status)
  }

  return res.json({ sessions, count: sessions.length })
})

// GET /api/collab/trust/:fromHandle/:toHandle
router.get('/collab/trust/:fromHandle/:toHandle', (req: Request, res: Response) => {
  const from = parseHandle(decodeURIComponent(req.params.fromHandle))
  const to = parseHandle(decodeURIComponent(req.params.toHandle))

  if (!from || !to) return res.status(400).json({ error: 'invalid_handle' })

  const relation = getTrust(from.full, to.full)
  return res.json({ relation: relation ?? null, exists: !!relation })
})

export default router
