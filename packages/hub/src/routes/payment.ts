// Hub routes - Payment Vault API
// POST /api/payment/submit         — Agent submits a payment request
// GET  /api/payment/pending        — Query pending human-approval requests
// POST /api/payment/approve/:id    — Human approves (X-Human-Token header)
// POST /api/payment/reject/:id     — Human rejects (X-Human-Token header)
// GET  /api/payment/audit/:nodeId  — Read-only audit log

import { Router, Request, Response } from 'express'
import { PaymentVault } from '@jackclaw/payment-vault'
const isSandboxMode = process.env.PAYMENT_SANDBOX === 'true'
import type { Jurisdiction } from '@jackclaw/protocol'

// Singleton vault instance — configured from environment
const vault = new PaymentVault({
  nodeId: 'hub',
  jurisdiction: (process.env.VAULT_JURISDICTION as Jurisdiction) || 'GLOBAL',
  humanTokenSecret: process.env.HUMAN_TOKEN_SECRET || 'change-me-in-production',
  vaultDir: process.env.VAULT_DIR || '',
})

const router = Router()

/**
 * POST /api/payment/submit
 * Body: payment request fields (amount, currency, recipient, etc.)
 * Returns: { payment: PaymentRequest }
 */
router.post('/submit', (req: Request, res: Response): void => {
  const body = req.body as Record<string, unknown>

  if (!body.amount || !body.currency || !body.recipient || !body.nodeId) {
    res.status(400).json({
      error: 'Missing required fields: amount, currency, recipient, nodeId',
    })
    return
  }

  try {
    const payment = vault.submit({
      nodeId: body.nodeId as string,
      handle: (body.handle as string) || '',
      amount: body.amount as number,
      currency: body.currency as string,
      recipient: body.recipient as string,
      description: (body.description as string) || '',
      category: (body.category as string) || 'general',
      jurisdiction: (body.jurisdiction as Jurisdiction) || 'GLOBAL',
      paymentMethod: (body.paymentMethod as string) || '',
      metadata: (body.metadata as Record<string, unknown>) || {},
    })

    res.status(201).json({ payment, sandboxMode: isSandboxMode })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

/**
 * GET /api/payment/pending
 * Returns: { requests: PaymentRequest[] }
 */
router.get('/pending', (_req: Request, res: Response): void => {
  try {
    const requests = vault.getPending()
    res.json({ requests, sandboxMode: isSandboxMode })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

/**
 * POST /api/payment/approve/:requestId
 * Headers: x-human-token: <HMAC token>
 * Returns: { payment: PaymentRequest }
 */
router.post('/approve/:requestId', (req: Request, res: Response): void => {
  const { requestId } = req.params
  const humanToken = req.headers['x-human-token'] as string | undefined

  if (!humanToken) {
    res.status(401).json({ error: 'Missing X-Human-Token header' })
    return
  }

  try {
    const payment = vault.humanApprove(requestId, humanToken)
    res.json({ payment, sandboxMode: isSandboxMode })
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('not found')) {
      res.status(404).json({ error: msg })
    } else if (msg.includes('Unauthorized')) {
      res.status(403).json({ error: msg })
    } else {
      res.status(400).json({ error: msg })
    }
  }
})

/**
 * POST /api/payment/reject/:requestId
 * Headers: x-human-token: <HMAC token>
 * Body: { reason: string }
 * Returns: { payment: PaymentRequest }
 */
router.post('/reject/:requestId', (req: Request, res: Response): void => {
  const { requestId } = req.params
  const humanToken = req.headers['x-human-token'] as string | undefined
  const { reason } = req.body as { reason?: string }

  if (!humanToken) {
    res.status(401).json({ error: 'Missing X-Human-Token header' })
    return
  }

  try {
    const payment = vault.humanReject(requestId, humanToken, reason || 'Rejected by human')
    res.json({ payment, sandboxMode: isSandboxMode })
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('not found')) {
      res.status(404).json({ error: msg })
    } else if (msg.includes('Unauthorized')) {
      res.status(403).json({ error: msg })
    } else {
      res.status(400).json({ error: msg })
    }
  }
})

/**
 * GET /api/payment/audit/:nodeId
 * Returns: { entries: PaymentRequest[] }
 */
router.get('/audit/:nodeId', (req: Request, res: Response): void => {
  const { nodeId } = req.params

  try {
    const entries = vault.getAuditLog(nodeId)
    res.json({ entries, sandboxMode: isSandboxMode })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router
