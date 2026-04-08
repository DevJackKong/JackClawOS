// POST /api/register - Node registration
// Accepts: nodeId, name, role, publicKey, inviteCode (required when HUB_INVITE_CODE is set)
// Returns: hubPublicKey, token (JWT)

import { Router, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { URL } from 'url'
import { registerNode, nodeExists } from '../store/nodes'
import { getHubKeys, JWT_SECRET } from '../server'

const router = Router()

// ─── Invite code protection ──────────────────────────────────────────────────
// Set HUB_INVITE_CODE env to require an invite code for new node registration.
// Existing nodes (re-registration / key rotation) are allowed without invite code.
const HUB_INVITE_CODE = process.env.HUB_INVITE_CODE?.trim() || ''

function verifyInviteCode(code: string | undefined): boolean {
  if (!HUB_INVITE_CODE) return true // no invite code configured → open registration
  if (!code || typeof code !== 'string') return false
  // Constant-time comparison to prevent timing attacks
  const a = Buffer.from(code.trim())
  const b = Buffer.from(HUB_INVITE_CODE)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

// ─── Input validation ────────────────────────────────────────────────────────
const NODE_ID_RE = /^[a-zA-Z0-9._@-]{1,64}$/
const MAX_NAME_LEN = 128
const MAX_ROLE_LEN = 64
const MAX_KEY_LEN = 8192 // PEM public key

// ─── SSRF protection for callbackUrl ─────────────────────────────────────────
// Block internal/private IPs to prevent SSRF via channels/ask aggregation
const PRIVATE_IP_RE = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|169\.254\.|::1|fc|fd|fe80)/i

function validateCallbackUrl(url: string | undefined): string | undefined {
  if (!url || typeof url !== 'string') return undefined
  try {
    const parsed = new URL(url)
    // Only allow http/https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('callbackUrl must use http or https')
    }
    // Block private/internal IPs
    if (PRIVATE_IP_RE.test(parsed.hostname) || parsed.hostname === 'localhost') {
      throw new Error('callbackUrl cannot point to private/internal addresses')
    }
    // Block non-standard dangerous ports
    if (parsed.port && parseInt(parsed.port) < 1024 && parseInt(parsed.port) !== 80 && parseInt(parsed.port) !== 443) {
      throw new Error('callbackUrl uses restricted port')
    }
    return parsed.origin + parsed.pathname.replace(/\/+$/, '')
  } catch (e: any) {
    throw new Error(`Invalid callbackUrl: ${e.message}`)
  }
}

router.post('/', (req: Request, res: Response): void => {
  const { nodeId, name, role, publicKey, callbackUrl, inviteCode } = req.body as {
    nodeId?: string
    name?: string
    role?: string
    publicKey?: string
    callbackUrl?: string
    inviteCode?: string
  }

  if (!nodeId || !name || !role || !publicKey) {
    res.status(400).json({ error: 'Missing required fields: nodeId, name, role, publicKey', code: 'VALIDATION_ERROR' })
    return
  }

  // Strict input validation
  if (typeof nodeId !== 'string' || !NODE_ID_RE.test(nodeId)) {
    res.status(400).json({ error: 'Invalid nodeId: must be 1-64 alphanumeric/._@- chars', code: 'VALIDATION_ERROR' })
    return
  }
  if (typeof name !== 'string' || name.length > MAX_NAME_LEN) {
    res.status(400).json({ error: `name must be ≤${MAX_NAME_LEN} chars`, code: 'VALIDATION_ERROR' })
    return
  }
  if (typeof role !== 'string' || role.length > MAX_ROLE_LEN) {
    res.status(400).json({ error: `role must be ≤${MAX_ROLE_LEN} chars`, code: 'VALIDATION_ERROR' })
    return
  }
  if (typeof publicKey !== 'string' || publicKey.length > MAX_KEY_LEN) {
    res.status(400).json({ error: 'publicKey too large', code: 'VALIDATION_ERROR' })
    return
  }

  try {
    const existing = nodeExists(nodeId)

    // New registration requires invite code (if configured)
    if (!existing && !verifyInviteCode(inviteCode)) {
      res.status(403).json({ error: 'Valid invite code required for new node registration', code: 'INVITE_REQUIRED' })
      return
    }

    // SECURITY: validate callbackUrl to prevent SSRF
    let sanitizedCallbackUrl: string | undefined
    try {
      sanitizedCallbackUrl = validateCallbackUrl(callbackUrl)
    } catch (e: any) {
      res.status(400).json({ error: e.message, code: 'VALIDATION_ERROR' })
      return
    }

    const node = registerNode({ nodeId, name, role, publicKey, callbackUrl: sanitizedCallbackUrl })

    const token = jwt.sign(
      { nodeId: node.nodeId, role: node.role },
      JWT_SECRET,
      { expiresIn: '30d' }
    )

    const { publicKey: hubPublicKey } = getHubKeys()

    res.status(existing ? 200 : 201).json({
      success: true,
      action: existing ? 'updated' : 'registered',
      hubPublicKey,
      token,
      node: {
        nodeId: node.nodeId,
        name: node.name,
        role: node.role,
        registeredAt: node.registeredAt,
      },
    })
  } catch (err: any) {
    console.error('[register] Error:', err)
    res.status(500).json({ error: err.message || 'Registration failed', code: 'INTERNAL_ERROR' })
  }
})

export default router
