/**
 * Agent Card Discovery — A2A + OpenAgents compatible
 *
 * GET /.well-known/agents.json    → list all public agents (A2A Agent Card format)
 * GET /.well-known/agents/:handle → single agent card
 *
 * Compatible with:
 * - Google A2A Agent Card spec
 * - OpenAgents discovery protocol
 */

import { Router, Request, Response } from 'express'
import { directoryStore } from '../store/directory'

const router = Router()

interface AgentCard {
  /** Agent's global handle */
  handle: string
  /** Human-readable name */
  name: string
  /** Agent role */
  role: string
  /** Capabilities / skills */
  capabilities: string[]
  /** Hub URL for communication */
  hubUrl: string
  /** Public key for verification */
  publicKey: string
  /** Contact policy */
  visibility: string
  /** Last seen timestamp */
  lastSeen?: number
  /** A2A compatible fields */
  a2a?: {
    version: string
    endpoint: string
    supportedMethods: string[]
  }
}

function profileToCard(profile: any, hubBaseUrl: string): AgentCard {
  return {
    handle: profile.handle,
    name: profile.displayName || profile.handle,
    role: profile.role || 'member',
    capabilities: profile.capabilities || [],
    hubUrl: profile.hubUrl || hubBaseUrl,
    publicKey: profile.publicKey || '',
    visibility: profile.visibility || 'public',
    lastSeen: profile.lastSeen,
    a2a: {
      version: '1.0',
      endpoint: `${profile.hubUrl || hubBaseUrl}/api/a2a`,
      supportedMethods: ['message/send', 'task/create', 'capability/query'],
    },
  }
}

// GET /.well-known/agents.json
router.get('/agents.json', (req: Request, res: Response) => {
  const hubBaseUrl = `${req.protocol}://${req.get('host')}`
  const publicProfiles = directoryStore.listPublic()
  const cards = publicProfiles.map(p => profileToCard(p, hubBaseUrl))

  res.json({
    protocol: 'jackclaw',
    version: '0.2.0',
    hubId: hubBaseUrl,
    agents: cards,
    totalAgents: cards.length,
    discoveredAt: new Date().toISOString(),
  })
})

// GET /.well-known/agents/:handle
router.get('/agents/:handle', (req: Request, res: Response) => {
  const hubBaseUrl = `${req.protocol}://${req.get('host')}`
  const handle = req.params.handle.startsWith('@') ? req.params.handle : `@${req.params.handle}`
  const profile = directoryStore.getProfile(handle)

  if (!profile) {
    return res.status(404).json({ error: 'Agent not found', handle })
  }

  return res.json(profileToCard(profile, hubBaseUrl))
})

export default router
