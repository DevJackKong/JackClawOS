// JackClaw Hub - Express Server
// Central node for CEO: receives and aggregates agent reports

import express, { Application, Request, Response, NextFunction } from 'express'
import rateLimit from 'express-rate-limit'
import morgan from 'morgan'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

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
import teachRoute from './routes/teach'
import { JWTPayload } from './types'

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

// ─── JWT Auth Middleware ───────────────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      jwtPayload?: JWTPayload
    }
  }
}

function jwtAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' })
    return
  }

  const token = authHeader.slice(7)
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JWTPayload
    req.jwtPayload = payload
    next()
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}

// ─── Server Factory ───────────────────────────────────────────────────────────

export function createServer(): Application {
  // Ensure hub keys exist at startup
  getHubKeys()

  const app = express()

  // Body parsing
  app.use(express.json({ limit: '1mb' }))

  // Request logging
  app.use(morgan('[:date[iso]] :method :url :status :response-time ms - :res[content-length]'))

  // Global rate limiting: 60 req/min per IP
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Limit: 60/min per IP.' },
  })
  app.use('/api/', limiter)

  // Health check (no auth)
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'jackclaw-hub', ts: Date.now() })
  })

  // Public: node registration (no JWT required — nodes need a token first)
  app.use('/api/register', registerRoute)

  // Protected: all other routes require JWT
  app.use('/api/', jwtAuthMiddleware)
  app.use('/api/report', reportRoute)
  app.use('/api/nodes', nodesRoute)
  app.use('/api/summary', summaryRoute)
  app.use('/api/memory', memoryRoute)
  app.use('/api/directory', directoryRoute)
  app.use('/api', directoryRoute)
  app.use('/api/watchdog', watchdogRoute)
  app.use('/api/review', humanReviewRoute)
  app.use('/api/payment', paymentRoute)
  app.use('/api/plan', planRoute)
  app.use('/api/teach', teachRoute)
  app.use('/api/chat', chatRouter)   // ClawChat REST

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' })
  })

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[hub] Unhandled error:', err)
    res.status(500).json({ error: 'Internal server error' })
  })

  return app
}
