/**
 * Hub reverse-tunnel route
 *
 * WS  /tunnel/ws?nodeId=xxx  — Intranet node establishes a persistent tunnel
 * ANY /tunnel/:nodeId/*       — External requests forwarded to the node via WS
 *
 * Protocol (JSON over WebSocket):
 *   Hub → Node: { type: 'request',  id, method, path, headers, body (base64) }
 *   Node → Hub: { type: 'response', id, status, headers, body (base64) }
 *   Hub → Node: { type: 'ready',    publicUrl }
 */

import { Router, Request, Response } from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import http from 'http'
import crypto from 'crypto'

const router = Router()

// ─── Protocol Types ───────────────────────────────────────────────────────────

interface TunnelRequestMsg {
  type: 'request'
  id: string
  method: string
  path: string
  headers: Record<string, string>
  body: string // base64
}

interface TunnelResponseMsg {
  type: 'response'
  id: string
  status: number
  headers: Record<string, string[]>
  body: string // base64
}

interface TunnelReadyMsg {
  type: 'ready'
  publicUrl: string
}

type TunnelMsg = TunnelRequestMsg | TunnelResponseMsg | TunnelReadyMsg

// ─── State ────────────────────────────────────────────────────────────────────

/** nodeId → active WebSocket */
const tunnels = new Map<string, WebSocket>()

/** requestId → pending promise callbacks */
const pending = new Map<string, {
  resolve: (msg: TunnelResponseMsg) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}>()

const REQUEST_TIMEOUT_MS = 30_000

// ─── WebSocket Server ─────────────────────────────────────────────────────────

/**
 * Attach the tunnel WebSocket handler to an existing http.Server.
 * Call this alongside attachChatWss in hub/index.ts.
 */
export function attachTunnelWss(server: http.Server, hubUrl: string): void {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/tunnel/ws')) return

    wss.handleUpgrade(req, socket as import('net').Socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  })

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    const params = new URL(req.url ?? '', 'http://hub').searchParams
    const nodeId = params.get('nodeId')

    if (!nodeId) {
      ws.close(1008, 'nodeId required')
      return
    }

    // Kick out any stale connection for this nodeId
    const existing = tunnels.get(nodeId)
    if (existing && existing.readyState === WebSocket.OPEN) {
      existing.close(1001, 'replaced by new connection')
    }

    tunnels.set(nodeId, ws)
    console.log(`[tunnel] Node "${nodeId}" connected (${tunnels.size} active)`)

    // Acknowledge with the public URL the node will be reachable at
    const publicUrl = `${hubUrl.replace(/\/$/, '')}/tunnel/${nodeId}`
    const ready: TunnelReadyMsg = { type: 'ready', publicUrl }
    ws.send(JSON.stringify(ready))

    ws.on('message', (data: Buffer | string) => {
      let msg: TunnelMsg
      try {
        msg = JSON.parse(data.toString()) as TunnelMsg
      } catch {
        return
      }

      if (msg.type === 'response') {
        const entry = pending.get(msg.id)
        if (entry) {
          clearTimeout(entry.timer)
          pending.delete(msg.id)
          entry.resolve(msg)
        }
      }
    })

    ws.on('close', () => {
      // Only remove if this is still the registered socket
      if (tunnels.get(nodeId) === ws) {
        tunnels.delete(nodeId)
        console.log(`[tunnel] Node "${nodeId}" disconnected (${tunnels.size} active)`)
      }
    })

    ws.on('error', (err: Error) => {
      console.error(`[tunnel] Node "${nodeId}" error:`, err.message)
    })
  })
}

/** Returns a snapshot of all connected node IDs. */
export function getConnectedTunnels(): string[] {
  return [...tunnels.keys()]
}

// ─── HTTP Forwarder ───────────────────────────────────────────────────────────

function forwardToNode(
  nodeId: string,
  method: string,
  path: string,
  headers: Record<string, string>,
  body: Buffer,
): Promise<TunnelResponseMsg> {
  const ws = tunnels.get(nodeId)
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error(`Node "${nodeId}" is not connected`))
  }

  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()

    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Tunnel request to "${nodeId}" timed out`))
    }, REQUEST_TIMEOUT_MS)

    pending.set(id, { resolve, reject, timer })

    const msg: TunnelRequestMsg = {
      type: 'request',
      id,
      method,
      path,
      headers,
      body: body.toString('base64'),
    }
    ws.send(JSON.stringify(msg))
  })
}

// ─── Express Routes ───────────────────────────────────────────────────────────

// List active tunnels (no auth for monitoring/debug)
router.get('/', (_req: Request, res: Response) => {
  res.json({ tunnels: getConnectedTunnels() })
})

// Forward any request to the node — mounted at /tunnel, so path is /:nodeId[/rest]
router.all('/:nodeId', proxyHandler)
router.all('/:nodeId/*', proxyHandler)

async function proxyHandler(req: Request, res: Response): Promise<void> {
  const { nodeId } = req.params

  // Reconstruct full path including query string
  const rawPath = req.url // relative to mount point; starts with /:nodeId
  const nodePrefix = `/${nodeId}`
  const suffix = rawPath.startsWith(nodePrefix) ? rawPath.slice(nodePrefix.length) || '/' : '/'

  // Collect request body
  const chunks: Buffer[] = []
  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', resolve)
    req.on('error', reject)
  })
  const body = Buffer.concat(chunks)

  // Strip hop-by-hop headers
  const HOP_BY_HOP = new Set([
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailers', 'transfer-encoding', 'upgrade',
  ])
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(k.toLowerCase()) && typeof v === 'string') {
      headers[k] = v
    }
  }

  try {
    const response = await forwardToNode(nodeId, req.method ?? 'GET', suffix, headers, body)

    for (const [key, values] of Object.entries(response.headers)) {
      res.setHeader(key, values)
    }
    res.status(response.status).send(Buffer.from(response.body, 'base64'))
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Tunnel error'
    const status = message.includes('not connected') ? 503 : 502
    res.status(status).json({ error: message })
  }
}

export default router
