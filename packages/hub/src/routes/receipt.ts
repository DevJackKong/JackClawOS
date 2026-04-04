/**
 * Hub Receipt 路由
 *
 * POST /receipt/delivered   — 标记送达
 * POST /receipt/read        — 标记已读
 * POST /receipt/read-batch  — 批量标记已读
 * POST /receipt/typing      — 发送输入中状态
 * GET  /receipt/status/:messageId — 查询消息状态
 */

import { Router, Request, Response } from 'express'
import type { MessageStatus, DeliveryReceipt, ReadReceipt, TypingIndicator } from '@jackclaw/protocol'
import { pushToNodeWs } from './chat'
import { chatWorker } from '../chat-worker'

const router = Router()

// In-memory receipt state per message
interface ReceiptState {
  from: string          // original sender nodeId
  status: MessageStatus
  deliveredTo: Set<string>
  readBy: Set<string>
}

const receiptStore = new Map<string, ReceiptState>()

function getOrCreate(messageId: string): ReceiptState {
  let state = receiptStore.get(messageId)
  if (!state) {
    const msg = chatWorker.store.getMessage(messageId)
    state = {
      from: msg?.from ?? '',
      status: 'accepted',
      deliveredTo: new Set(),
      readBy: new Set(),
    }
    receiptStore.set(messageId, state)
  }
  return state
}

// POST /api/receipt/delivered
router.post('/delivered', (req: Request, res: Response) => {
  const { messageId, nodeId } = req.body as { messageId: string; nodeId: string }
  if (!messageId || !nodeId) {
    res.status(400).json({ error: 'messageId and nodeId required' })
    return
  }

  const state = getOrCreate(messageId)
  state.deliveredTo.add(nodeId)
  if (state.status === 'accepted' || state.status === 'sent') {
    state.status = 'acked'
  }

  const receipt: DeliveryReceipt = { messageId, status: 'acked', nodeId, ts: Date.now() }
  if (state.from) {
    pushToNodeWs(state.from, 'receipt', receipt)
  }

  res.json({ status: 'ok', receipt })
})

// POST /api/receipt/read
router.post('/read', (req: Request, res: Response) => {
  const { messageId, readBy } = req.body as { messageId: string; readBy: string }
  if (!messageId || !readBy) {
    res.status(400).json({ error: 'messageId and readBy required' })
    return
  }

  const state = getOrCreate(messageId)
  state.readBy.add(readBy)
  state.status = 'consumed'

  const receipt: ReadReceipt = { messageId, readBy, ts: Date.now() }
  if (state.from) {
    pushToNodeWs(state.from, 'receipt', { ...receipt, status: 'consumed' as MessageStatus })
  }

  res.json({ status: 'ok', receipt })
})

// POST /api/receipt/read-batch
router.post('/read-batch', (req: Request, res: Response) => {
  const { messageIds, readBy } = req.body as { messageIds: string[]; readBy: string }
  if (!Array.isArray(messageIds) || messageIds.length === 0 || !readBy) {
    res.status(400).json({ error: 'messageIds (array) and readBy required' })
    return
  }

  const ts = Date.now()
  const receipts: ReadReceipt[] = []

  for (const messageId of messageIds) {
    const state = getOrCreate(messageId)
    state.readBy.add(readBy)
    state.status = 'consumed'
    const receipt: ReadReceipt = { messageId, readBy, ts }
    receipts.push(receipt)
    if (state.from) {
      pushToNodeWs(state.from, 'receipt', { ...receipt, status: 'consumed' as MessageStatus })
    }
  }

  res.json({ status: 'ok', count: receipts.length, receipts })
})

// POST /api/receipt/typing
router.post('/typing', (req: Request, res: Response) => {
  const { fromAgent, threadId, isTyping, to } = req.body as TypingIndicator & { to?: string }
  if (!fromAgent || !threadId) {
    res.status(400).json({ error: 'fromAgent and threadId required' })
    return
  }

  const indicator: TypingIndicator = { fromAgent, threadId, isTyping: Boolean(isTyping) }

  if (to) {
    pushToNodeWs(to, 'typing', indicator)
  }

  res.json({ status: 'ok', indicator })
})

// GET /api/receipt/status/:messageId
router.get('/status/:messageId', (req: Request, res: Response) => {
  const { messageId } = req.params
  const state = receiptStore.get(messageId)

  if (!state) {
    const msg = chatWorker.store.getMessage(messageId)
    if (!msg) {
      res.status(404).json({ error: 'Message not found' })
      return
    }
    res.json({ messageId, status: 'accepted' as MessageStatus, deliveredTo: [], readBy: [] })
    return
  }

  res.json({
    messageId,
    status: state.status,
    deliveredTo: [...state.deliveredTo],
    readBy: [...state.readBy],
  })
})

export default router
