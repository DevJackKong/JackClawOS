// JackClaw Hub - Entry Point

import http from 'http'
import { createServer } from './server'
import { attachChatWss } from './routes/chat'
import { attachTunnelWss } from './routes/tunnel'

// ─── Process-level error guards (log but don't crash) ─────────────────────────

process.on('uncaughtException', (err) => {
  console.error('[hub] uncaughtException:', err)
})

process.on('unhandledRejection', (reason) => {
  console.error('[hub] unhandledRejection:', reason)
})

const PORT = parseInt(process.env.PORT ?? process.env.HUB_PORT ?? '3100', 10)

const app = createServer()
const httpServer = http.createServer(app)

// ClawChat WebSocket
attachChatWss(httpServer)

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[hub] JackClaw Hub listening on http://0.0.0.0:${PORT}`)
  console.log(`[hub] Dashboard: http://localhost:${PORT}`)
  console.log(`[hub] PWA App:   http://localhost:${PORT}/app/`)
  console.log(`[hub] Routes:`)
  console.log(`  POST /api/register     - Node registration`)
  console.log(`  POST /api/report       - Receive agent report (JWT)`)
  console.log(`  GET  /api/nodes        - List nodes (JWT)`)
  console.log(`  GET  /api/summary      - Daily summary (JWT)`)
  console.log(`  POST /api/chat/send    - ClawChat send message`)
  console.log(`  POST /api/agent/session - Agent Session Protocol (ASP)`)
  console.log(`  GET  /api/chat/inbox   - Pull offline messages`)
  console.log(`  WS   /chat/ws          - ClawChat realtime`)
  console.log(`  POST /api/ask          - Ask any LLM via node gateway`)
  console.log(`  GET  /health           - Health check`)
})

export default app
