import { Router, Request, Response } from 'express'
import { chatContextService } from '../services/chat-context'
import { asyncHandler } from '../server'

const router = Router()

/**
 * GET /api/chat-context/:nodeId
 * Get chat context for the specified node.
 * 获取指定 node 的聊天上下文。
 *
 * Query params:
 * - tenantId?: optional tenant scope / 可选租户作用域
 */
router.get('/:nodeId', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const nodeId = req.params.nodeId
  const tenantId = req.query.tenantId as string | undefined

  if (!nodeId?.trim()) {
    res.status(400).json({ error: 'nodeId is required', code: 'VALIDATION_ERROR' })
    return
  }

  const chatContext = await chatContextService.getContext(nodeId, tenantId)
  res.json(chatContext)
}))

export default router
