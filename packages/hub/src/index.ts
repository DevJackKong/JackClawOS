// JackClaw Hub - Entry Point

import http from 'http'
import { createServer } from './server'
import { attachChatWss } from './routes/chat'

const PORT = parseInt(process.env.HUB_PORT ?? '3100', 10)

const app = createServer()
const httpServer = http.createServer(app)

// ClawChat WebSocket
attachChatWss(httpServer)

httpServer.listen(PORT, () => {
  console.log(`[hub] JackClaw Hub listening on http://localhost:${PORT}`)
  console.log(`[hub] Dashboard: http://localhost:${PORT}`)
  console.log(`[hub] Routes:`)
  console.log(`  POST /api/register     - Node registration`)
  console.log(`  POST /api/report       - Receive agent report (JWT)`)
  console.log(`  GET  /api/nodes        - List nodes (JWT)`)
  console.log(`  GET  /api/summary      - Daily summary (JWT)`)
  console.log(`  POST /api/chat/send    - ClawChat send message`)
  console.log(`  GET  /api/chat/inbox   - Pull offline messages`)
  console.log(`  WS   /chat/ws          - ClawChat realtime`)
  console.log(`  GET  /health           - Health check`)
})

export default app
