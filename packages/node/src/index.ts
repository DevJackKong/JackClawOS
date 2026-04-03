import cron from 'node-cron'
import { loadConfig } from './config'
import { loadOrCreateIdentity } from './identity'
import { createServer } from './server'
import { registerWithHub, sendReportToHub } from './hub'
import { buildDailyReport } from './reporter'
import { createMessage } from '@jackclaw/protocol'

async function main() {
  console.log('🦞 JackClaw Node starting...')

  const config = loadConfig()
  const identity = loadOrCreateIdentity()

  if (config.nodeId) {
    identity.nodeId = config.nodeId
  }

  console.log(`[node] Node ID: ${identity.nodeId}`)
  console.log(`[node] Hub: ${config.hubUrl}`)
  console.log(`[node] Port: ${config.port}`)

  // 1. Register with Hub (best-effort, non-blocking)
  await registerWithHub(identity, config)

  // 2. Start HTTP server
  const app = createServer(identity, config)
  app.listen(config.port, () => {
    console.log(`[server] Listening on port ${config.port}`)
  })

  // 3. Schedule daily report
  if (!cron.validate(config.reportCron)) {
    console.error(`[cron] Invalid cron expression: "${config.reportCron}", using default "0 8 * * *"`)
    config.reportCron = '0 8 * * *'
  }

  console.log(`[cron] Report scheduled: ${config.reportCron}`)

  cron.schedule(config.reportCron, async () => {
    console.log('[cron] Generating daily report...')
    try {
      const report = buildDailyReport(config)

      // Encrypt for Hub (if Hub public key available) or send plaintext wrapped
      const hubPublicKey: string | undefined = (config as any).hubPublicKey

      if (hubPublicKey) {
        const msg = createMessage(
          identity.nodeId,
          'hub',
          'report',
          report,
          hubPublicKey,
          identity.privateKey,
        )
        await sendReportToHub(identity.nodeId, JSON.stringify(msg), config)
      } else {
        // Dev mode: send unencrypted (wrapped in plain JSON)
        console.warn('[cron] Hub public key not set — sending unencrypted report (dev mode)')
        await sendReportToHub(identity.nodeId, JSON.stringify({ plain: true, report }), config)
      }
    } catch (err: any) {
      console.error('[cron] Report failed:', err.message)
    }
  })

  // 4. Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('[node] SIGTERM received, shutting down.')
    process.exit(0)
  })
  process.on('SIGINT', () => {
    console.log('[node] SIGINT received, shutting down.')
    process.exit(0)
  })

  console.log('🦞 JackClaw Node ready.')
}

main().catch((err) => {
  console.error('[fatal]', err)
  process.exit(1)
})
