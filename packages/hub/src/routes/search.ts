/**
 * Search Routes
 *
 * GET /api/search/messages?q=&from=&to=&after=&before=&limit=&offset=
 * GET /api/search/contacts?q=
 */

import { Router, Request, Response } from 'express'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { messageStore } from '../store/message-store'
import { presenceManager } from '../presence'
import { directoryStore } from '../store/directory'
import type { SocialProfile } from '@jackclaw/protocol'

const router = Router()
const HUB_DIR = path.join(os.homedir(), '.jackclaw', 'hub')

// ─── GET /messages ────────────────────────────────────────────────────────────

router.get('/messages', (req: Request, res: Response) => {
  const {
    q,
    from,
    to,
    after,
    before,
    limit: limitStr,
    offset: offsetStr,
  } = req.query as Record<string, string>

  if (!q?.trim()) {
    return res.status(400).json({ error: 'q (query) required' })
  }

  const results = messageStore.searchMessages(q, {
    from:   from   || undefined,
    to:     to     || undefined,
    after:  after  ? parseInt(after,  10) : undefined,
    before: before ? parseInt(before, 10) : undefined,
    limit:  limitStr  ? Math.min(parseInt(limitStr,  10), 100) : 20,
    offset: offsetStr ? parseInt(offsetStr, 10) : 0,
  })

  return res.json({ results, count: results.length })
})

// ─── GET /contacts ────────────────────────────────────────────────────────────

router.get('/contacts', (req: Request, res: Response) => {
  const { q } = req.query as { q?: string }
  if (!q?.trim()) {
    return res.status(400).json({ error: 'q (query) required' })
  }

  const qLow = q.toLowerCase()

  // Load directory + profiles
  let dir: Record<string, { nodeId: string }> = {}
  let profiles: Record<string, SocialProfile> = {}
  try { dir      = JSON.parse(fs.readFileSync(path.join(HUB_DIR, 'directory.json'), 'utf-8')) } catch { /* ok */ }
  try { profiles = JSON.parse(fs.readFileSync(path.join(HUB_DIR, 'social-profiles.json'), 'utf-8')) } catch { /* ok */ }

  const seen = new Set<string>()
  const contacts: Array<{ handle: string; displayName: string; nodeId: string; role: string; online: boolean }> = []

  // Match by handle
  for (const [handle, info] of Object.entries(dir)) {
    if (handle.toLowerCase().includes(qLow)) {
      seen.add(handle)
      const profile = profiles[handle] ?? null
      contacts.push({
        handle,
        nodeId:      info.nodeId,
        displayName: profile?.ownerName ?? handle,
        role:        directoryStore.getProfile(handle)?.role ?? 'member',
        online:      presenceManager.getPresence(handle).online,
      })
    }
  }

  // Match by ownerName / bio in profiles for handles not already listed
  for (const [handle, p] of Object.entries(profiles)) {
    if (seen.has(handle)) continue
    if (
      p.ownerName?.toLowerCase().includes(qLow) ||
      p.bio?.toLowerCase().includes(qLow)
    ) {
      contacts.push({
        handle,
        nodeId:      dir[handle]?.nodeId ?? '',
        displayName: p.ownerName ?? handle,
        role:        directoryStore.getProfile(handle)?.role ?? 'member',
        online:      presenceManager.getPresence(handle).online,
      })
    }
  }

  return res.json({ contacts, count: contacts.length })
})

export default router
