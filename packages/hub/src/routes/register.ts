// POST /api/register - Node registration
// Accepts: nodeId, name, role, publicKey
// Returns: hubPublicKey, token (JWT)

import { Router, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { registerNode, nodeExists } from '../store/nodes'
import { getHubKeys, JWT_SECRET } from '../server'

const router = Router()

router.post('/', (req: Request, res: Response): void => {
  const { nodeId, name, role, publicKey } = req.body as {
    nodeId?: string
    name?: string
    role?: string
    publicKey?: string
  }

  if (!nodeId || !name || !role || !publicKey) {
    res.status(400).json({ error: 'Missing required fields: nodeId, name, role, publicKey' })
    return
  }

  // Basic validation
  if (typeof nodeId !== 'string' || nodeId.length > 64) {
    res.status(400).json({ error: 'Invalid nodeId' })
    return
  }

  const existing = nodeExists(nodeId)

  const node = registerNode({ nodeId, name, role, publicKey })

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
})

export default router
