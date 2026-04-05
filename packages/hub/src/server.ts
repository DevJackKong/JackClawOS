// JackClaw Hub - Express Server
// Central node for CEO: receives and aggregates agent reports

import express, { Application, Request, Response, NextFunction, RequestHandler } from 'express'
import morgan from 'morgan'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { rateLimiter, corsConfig, cspHeaders, inputSanitizer, keyRotation } from './security'

import registerRoute from './routes/register'
import reportRoute from './routes/report'
import nodesRoute from './routes/nodes'
import summaryRoute from './routes/summary'
import memoryRoute from './routes/memory'
import directoryRoute from './routes/directory'
import watchdogRoute from './routes/watchdog'
import humanReviewRoute from './routes/human-review'
import paymentRoute from './routes/payment'
import planRoute from './routes/plan'
import { chatRouter, attachChatWss } from './routes/chat'
import { chatWorker } from './chat-worker'
import humansRoute from './routes/humans'
import teachRoute from './routes/teach'
import orgNormRoute from './routes/org-norm'
import orgMemoryRoute from './routes/org-memory'
import askRoute from './routes/ask'
import socialRoute from './routes/social'
import authRoute from './routes/auth'
import filesRoute from './routes/files'
import groupsRoute from './routes/groups'
import federationRoute from './routes/federation'
import receiptRoute from './routes/receipt'
import traceRoute from './routes/trace'
import healthRoute from './routes/health'
import agentCardRoute from './routes/agent-card'
import pluginsRoute from './routes/plugins'
import profilePageRoute from './routes/profile-page'
import moltbookRoute from './routes/moltbook'
import tasksRoute from './routes/tasks'
import channelsRoute from './routes/channels'
import pushRoute from './routes/push'
import searchRoute from './routes/search'
import presenceRoute from './routes/presence'
import { initFederationManager } from './federation'
import { JWTPayload } from './types'
import tunnelRoute from './routes/tunnel'

// ─── Hub Configuration ────────────────────────────────────────────────────────

const HUB_DIR = path.join(process.env.HOME || '~', '.jackclaw', 'hub')
const KEYS_FILE = path.join(HUB_DIR, 'keys.json')

export const JWT_SECRET: string = process.env.JWT_SECRET
  ?? (() => {
    const secretFile = path.join(HUB_DIR, 'jwt-secret')
    fs.mkdirSync(HUB_DIR, { recursive: true })
    if (fs.existsSync(secretFile)) {
      return fs.readFileSync(secretFile, 'utf-8').trim()
    }
    const secret = crypto.randomBytes(48).toString('hex')
    fs.writeFileSync(secretFile, secret, { mode: 0o600 })
    return secret
  })()

// ─── Hub RSA Key Management ───────────────────────────────────────────────────

interface HubKeys {
  publicKey: string   // PEM
  privateKey: string  // PEM
}

let _hubKeys: HubKeys | null = null

export function getHubKeys(): HubKeys {
  if (_hubKeys) return _hubKeys

  fs.mkdirSync(HUB_DIR, { recursive: true })

  if (fs.existsSync(KEYS_FILE)) {
    try {
      _hubKeys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8')) as HubKeys
      return _hubKeys
    } catch {
      // regenerate below
    }
  }

  console.log('[hub] Generating RSA-4096 key pair for hub...')
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })

  _hubKeys = { publicKey, privateKey }
  fs.writeFileSync(KEYS_FILE, JSON.stringify(_hubKeys, null, 2), { mode: 0o600 })
  console.log('[hub] Hub key pair generated and saved.')
  return _hubKeys
}

// ─── Async Handler Wrapper ────────────────────────────────────────────────────

/**
 * Wraps an async route handler so unhandled promise rejections
 * are forwarded to the Express error middleware instead of crashing.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next)
  }
}

// ─── JWT Auth Middleware ───────────────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      jwtPayload?: JWTPayload
    }
  }
}

/**
 * Verify JWT against all active secrets (current + previous keys in rotation window).
 * Falls back to the legacy JWT_SECRET for tokens issued before key rotation was added.
 */
function jwtAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' })
    return
  }

  const token = authHeader.slice(7)
  // Try all active rotating keys, then fall back to the legacy static secret
  const secrets = [...keyRotation.getActiveSecrets(), JWT_SECRET]

  for (const secret of secrets) {
    try {
      const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as JWTPayload
      req.jwtPayload = payload
      next()
      return
    } catch { /* try next secret */ }
  }
  res.status(401).json({ error: 'Invalid or expired token' })
}

// ─── Server Factory ───────────────────────────────────────────────────────────

export function createServer(): Application {
  // Ensure hub keys exist at startup; initialize federation manager
  const { publicKey, privateKey } = getHubKeys()
  const hubUrl = process.env.HUB_URL ?? `http://localhost:${process.env.HUB_PORT ?? 3100}`
  initFederationManager(hubUrl, publicKey, privateKey)

  // Start JWT key auto-rotation (checks every hour, rotates after 30 days)
  keyRotation.startAutoRotation()

  const app = express()

  // CORS — must be first so preflight OPTIONS requests are handled before other middleware
  app.use(corsConfig())

  // Content Security Policy + hardening headers
  app.use(cspHeaders())

  // Body parsing (1MB limit for JSON; file routes handle their own body)
  app.use(express.json({ limit: '1mb' }))

  // Input sanitization (strip null bytes; enforce size limit pre-parse)
  app.use('/api/', inputSanitizer())

  // Request logging
  app.use(morgan('[:date[iso]] :method :url :status :response-time ms - :res[content-length]'))

  // Global rate limiting: 1000 req/min per IP+nodeId
  app.use('/api/', rateLimiter.global)

  // Dashboard — serve built React app from dashboard/dist first, then fall back to legacy public/
  const dashboardDist = path.join(__dirname, '..', '..', 'dashboard', 'dist')
  if (fs.existsSync(dashboardDist)) {
    app.use(express.static(dashboardDist))
  }
  const publicDir = path.join(__dirname, '..', 'public')
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir))
  }

  // Health check & observability (no auth)
  app.use('/health', healthRoute)

  // Agent Card discovery (no auth) — A2A + OpenAgents compatible
  app.use('/.well-known', agentCardRoute)

  // Public: node registration (no JWT required — nodes need a token first)
  app.use('/api/register', registerRoute)

  // Public: user auth — strict rate limits to prevent brute-force and account flooding
  app.post('/api/auth/login', rateLimiter.login)
  app.post('/api/auth/register', rateLimiter.register)
  app.use('/api/auth', authRoute)

  // Public: ClawChat (nodes authenticate via WebSocket nodeId); message send is rate-limited
  app.post('/api/chat/send', rateLimiter.message)
  app.use('/api/chat', chatRouter)

  // Public: Human accounts — humanToken auth (no JWT needed)
  app.use('/api/humans', humansRoute)

  // Public: receipt delivery/read status (nodes authenticate via nodeId in body)
  app.use('/api/receipt', receiptRoute)
  app.use('/api/chat', traceRoute)       // message trace & status

  // Public: inter-hub federation protocol (hub-to-hub, no JWT)
  app.use('/api/federation', federationRoute)

  // Public: user profile pages (HTML, no JWT)
  app.use('/', profilePageRoute)

  // Protected: all other routes require JWT
  app.use('/api/', jwtAuthMiddleware)
  app.use('/api/reports', reportRoute)        // POST / — submit node daily report
  app.use('/api/nodes', nodesRoute)           // GET / — list registered nodes; POST /:nodeId/workload
  app.use('/api/summary', summaryRoute)       // GET / — daily digest summary
  app.use('/api/memory', memoryRoute)         // org memory, collab sessions, push/pull
  app.use('/api/directory', directoryRoute)   // GET /lookup/:handle, POST /register, /collab/*
  app.use('/api/watchdog', watchdogRoute)     // heartbeat, status, policy, alerts
  app.use('/api/review', humanReviewRoute)    // human-in-the-loop review requests
  app.use('/api/payment', paymentRoute)       // payment requests, approvals, audit
  app.use('/api/plan', planRoute)             // POST /estimate — task estimation
  app.use('/api/teach', teachRoute)           // knowledge sharing sessions
  app.use('/api/org-norm', orgNormRoute)      // organisation norms CRUD
  app.use('/api/org-memory', orgMemoryRoute)  // organisation memory CRUD + search
  app.use('/api/ask', askRoute)               // GET /providers; POST / — LLM proxy
  app.use('/api/social', socialRoute)         // social graph: contacts, messages, profiles
  app.use('/api/groups', groupsRoute)         // group chat management
  app.use('/api/channels', channelsRoute)     // GET / — aggregate node channel status; POST /configure
  app.use('/api/push', pushRoute)             // web push: subscribe, unsubscribe, test
  app.use('/api/search', searchRoute)         // GET /messages, GET /contacts — full-text search
  // Files: raw body handled in-route; rate-limited separately
  app.use('/api/files', rateLimiter.upload, filesRoute)
  app.use('/api/moltbook', moltbookRoute)     // Moltbook social integration
  app.use('/api/tasks', tasksRoute)           // async task queue: submit, status, cancel
  app.use('/api/presence', presenceRoute)     // GET /:handle, GET /online — presence queries
  app.use('/api/plugins', pluginsRoute)       // GET / — list plugins; GET /stats; GET /events
  app.use('/tunnel', tunnelRoute)             // WS /tunnel/ws; ANY /tunnel/:nodeId/* — reverse proxy

  // SPA fallback — serve dashboard index.html for all non-API GET requests
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/chat/')) {
      return next()
    }
    const indexPath = path.join(__dirname, '..', '..', 'dashboard', 'dist', 'index.html')
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath)
    } else {
      next()
    }
  })

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' })
  })

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[hub] Unhandled error:', err)
    res.status(500).json({ error: err.message || 'Internal server error', code: 'INTERNAL_ERROR' })
  })

  return app
}
