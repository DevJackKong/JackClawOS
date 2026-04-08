import { Router, Request, Response } from 'express'
import { pluginSystem } from '../plugin-system'
import { asyncHandler } from '../server'

const router = Router()

/**
 * GET /api/plugins
 * 列出所有已注册插件 / List all registered plugins
 */
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const plugins = pluginSystem.listPlugins()

  res.json({
    success: true,
    data: plugins,
  })
}))

/**
 * GET /api/plugins/:id
 * 获取单个插件详情 / Get a single plugin detail
 */
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params
  const plugin = pluginSystem.getPlugin(id)

  if (!plugin) {
    res.status(404).json({
      success: false,
      error: 'Plugin not found',
      code: 'PLUGIN_NOT_FOUND',
    })
    return
  }

  res.json({
    success: true,
    data: plugin,
  })
}))

/**
 * POST /api/plugins/:id/enable
 * 启用插件 / Enable plugin
 */
router.post('/:id/enable', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params
  const plugin = pluginSystem.enable(id)

  res.json({
    success: true,
    message: 'Plugin enabled successfully',
    data: plugin,
  })
}))

/**
 * POST /api/plugins/:id/disable
 * 禁用插件 / Disable plugin
 */
router.post('/:id/disable', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params
  const plugin = pluginSystem.disable(id)

  res.json({
    success: true,
    message: 'Plugin disabled successfully',
    data: plugin,
  })
}))

/**
 * DELETE /api/plugins/:id
 * 卸载插件 / Unregister plugin
 */
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params
  const removed = pluginSystem.unregister(id)

  if (!removed) {
    res.status(404).json({
      success: false,
      error: 'Plugin not found',
      code: 'PLUGIN_NOT_FOUND',
    })
    return
  }

  res.json({
    success: true,
    message: 'Plugin unregistered successfully',
    data: { id, removed },
  })
}))

export default router
