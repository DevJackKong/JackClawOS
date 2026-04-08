/**
 * Hub /api/ask — proxy LLM requests to nodes
 *
 * GET  /api/ask/providers  — list all nodes and their available LLM providers
 * POST /api/ask            — proxy prompt to a node (round-robin if nodeId omitted)
 */
import { Router, Request, Response } from 'express'
import http from 'http'
import { getAllNodes, getNode } from '../store/nodes.js'
import { asyncHandler } from '../server.js'
import { requireAdmin, requireAuth } from './rbac-helpers'

const router = Router()

// GET /providers — SECURITY: admin only (exposes node topology + callbackUrls internally)
router.get('/providers', asyncHandler(async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return
  const nodes = getAllNodes().filter(n => n.callbackUrl)
  const results = await Promise.all(nodes.map(async (node) => {
    try {
      const url = new URL('/api/ask/providers', node.callbackUrl!)
      const providers = await new Promise<string[]>((resolve) => {
        const r = http.request(url, { method: 'GET', timeout: 5000 }, (resp) => {
          let d = ''
          resp.on('data', c => (d += c))
          resp.on('end', () => {
            try { resolve((JSON.parse(d) as { providers?: string[] }).providers ?? []) }
            catch { resolve([]) }
          })
        })
        r.on('error', () => resolve([]))
        r.on('timeout', () => { r.destroy(); resolve([]) })
        r.end()
      })
      return { nodeId: node.nodeId, providers }
    } catch {
      return { nodeId: node.nodeId, providers: [] }
    }
  }))

  const nodeMap: Record<string, string[]> = {}
  for (const { nodeId, providers } of results) nodeMap[nodeId] = providers
  res.json({ nodes: nodeMap })
}))

// POST / — route prompt to a specific node or auto-select an available worker
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { nodeId, prompt, model, systemPrompt, temperature, max_tokens } = req.body

  if (!prompt) {
    res.status(400).json({ error: 'prompt required' })
    return
  }

  // Find target node
  const targetNode = nodeId
    ? getNode(nodeId)
    : getAllNodes().find(n => n.role !== 'ceo' && n.callbackUrl)

  if (!targetNode || !targetNode.callbackUrl) {
    const available = getAllNodes().map(n => n.nodeId)
    res.status(503).json({ error: 'No available node to handle request', available })
    return
  }

  const nodeUrl = new URL('/api/ask', targetNode.callbackUrl)
  const body = JSON.stringify({ prompt, model, systemPrompt, temperature, max_tokens })

  try {
    const result = await new Promise<any>((resolve, reject) => {
      const r = http.request(nodeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 120000,
      }, (resp) => {
        let d = ''
        resp.on('data', c => (d += c))
        resp.on('end', () => {
          try { resolve(JSON.parse(d)) }
          catch { resolve({ error: 'invalid response', raw: d.slice(0, 200) }) }
        })
      })
      r.on('error', reject)
      r.on('timeout', () => { r.destroy(); reject(new Error('Node request timeout')) })
      r.write(body)
      r.end()
    })

    res.json({ ...result, routedTo: targetNode.nodeId })
  } catch (err: any) {
    res.status(502).json({ error: `Node unreachable: ${err.message}`, code: 'BAD_GATEWAY', nodeId: targetNode.nodeId })
  }
}))

export default router
