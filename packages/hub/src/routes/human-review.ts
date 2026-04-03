// Hub routes - HumanInLoop 审查 API
// POST /api/review/request  — 提交人工审查请求
// GET  /api/review/pending  — 查询待处理请求
// POST /api/review/resolve/:requestId — 真人决策（需 human-token header）

import { Router, Request, Response } from 'express'
import { humanInLoopManager, HumanReviewRequest } from '@jackclaw/protocol'

const router = Router()

/**
 * POST /api/review/request
 * Body: Omit<HumanReviewRequest, 'requestId' | 'createdAt'>
 * Returns: { requestId }
 */
router.post('/request', async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Partial<Omit<HumanReviewRequest, 'requestId' | 'createdAt'>>

  // 基本字段校验
  if (!body.trigger || !body.nodeId || !body.description) {
    res.status(400).json({
      error: 'Missing required fields: trigger, nodeId, description',
    })
    return
  }

  if (!body.options || !Array.isArray(body.options) || body.options.length === 0) {
    res.status(400).json({
      error: 'options must be a non-empty array of ReviewOption',
    })
    return
  }

  if (!body.defaultOnTimeout) {
    res.status(400).json({
      error: 'defaultOnTimeout is required (approve | reject | defer)',
    })
    return
  }

  try {
    const requestId = await humanInLoopManager.requestReview({
      trigger: body.trigger,
      nodeId: body.nodeId,
      description: body.description,
      context: body.context ?? {},
      options: body.options,
      deadline: body.deadline,
      defaultOnTimeout: body.defaultOnTimeout,
    })

    res.status(201).json({ requestId })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

/**
 * GET /api/review/pending
 * Query: ?nodeId=xxx (optional)
 * Returns: { requests: HumanReviewRequest[] }
 */
router.get('/pending', async (req: Request, res: Response): Promise<void> => {
  const nodeId = req.query.nodeId as string | undefined

  try {
    const requests = await humanInLoopManager.getPending(nodeId)
    res.json({ requests })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

/**
 * POST /api/review/resolve/:requestId
 * Headers: human-token: <HMAC token>
 * Body: { decision: string }
 * Returns: { success: true }
 *
 * human-token = HMAC-SHA256(requestId, HUMAN_TOKEN_SECRET)
 * 只有持有 secret 的真人调用者可以执行此操作。
 */
router.post('/resolve/:requestId', async (req: Request, res: Response): Promise<void> => {
  const { requestId } = req.params
  const humanToken = req.headers['human-token'] as string | undefined
  const { decision } = req.body as { decision?: string }

  if (!humanToken) {
    res.status(401).json({ error: 'Missing human-token header' })
    return
  }

  if (!decision) {
    res.status(400).json({ error: 'Missing decision in request body' })
    return
  }

  try {
    await humanInLoopManager.resolve(requestId, decision, humanToken)
    res.json({ success: true })
  } catch (err) {
    const message = (err as Error).message
    if (message.includes('not found')) {
      res.status(404).json({ error: message })
    } else if (message.includes('Unauthorized') || message.includes('Invalid human-token')) {
      res.status(403).json({ error: message })
    } else if (message.includes('already resolved')) {
      res.status(409).json({ error: message })
    } else {
      res.status(400).json({ error: message })
    }
  }
})

export default router
