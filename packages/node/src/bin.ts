import { main } from './index'

main().catch((err: Error) => {
  console.error('[fatal]', err)
  process.exit(1)
})
