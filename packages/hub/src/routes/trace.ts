/**
 * Message Trace API — query message status and full delivery trace
 *
 * GET /api/chat/message/:id/status  → current status
 * GET /api/chat/message/:id/trace   → full state transition history
 */

import { Router } from 'express'
import { getMessageStatus, getMessageTrace } from '../chat-worker'

const router = Router()

/**
 * GET /api/chat/message/:id/status
 * Returns the current delivery status of a message.
 */
router.get('/message/:id/status', (req, res) => {
  const { id } = req.params
  const status = getMessageStatus(id)
  if (!status) {
    return res.status(404).json({ error: 'Message not found or not tracked', messageId: id })
  }
  return res.json({ messageId: id, status, ts: Date.now() })
})

/**
 * GET /api/chat/message/:id/trace
 * Returns the full state transition history of a message.
 */
router.get('/message/:id/trace', (req, res) => {
  const { id } = req.params
  const trace = getMessageTrace(id)
  if (trace.length === 0) {
    return res.status(404).json({ error: 'No trace found', messageId: id })
  }
  const currentStatus = trace[trace.length - 1].to
  return res.json({
    messageId: id,
    currentStatus,
    transitions: trace,
    count: trace.length,
  })
})

export default router
