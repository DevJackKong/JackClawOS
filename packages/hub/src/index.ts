// JackClaw Hub - Entry Point

import { createServer } from './server'

const PORT = parseInt(process.env.HUB_PORT ?? '3100', 10)

const app = createServer()

app.listen(PORT, () => {
  console.log(`[hub] JackClaw Hub listening on http://localhost:${PORT}`)
  console.log(`[hub] Routes:`)
  console.log(`  POST /api/register  - Node registration`)
  console.log(`  POST /api/report    - Receive agent report (JWT)`)
  console.log(`  GET  /api/nodes     - List nodes (CEO only, JWT)`)
  console.log(`  GET  /api/summary   - Daily summary (JWT)`)
  console.log(`  GET  /health        - Health check`)
})

export default app
