import { resolve } from 'node:path'
import { migrateSchema } from './schema.js'

export async function startWorker(opts: { concurrency?: number } = {}) {
  const cwd = process.cwd()

  console.log('[openshop] Starting worker...')

  process.env.DATABASE_URL ??= 'postgresql://openshop:openshop@localhost:5432/openshop'

  try {
    await migrateSchema(cwd, { silent: true })
  } catch {
    console.error('[openshop] Database migration failed')
    process.exit(1)
  }

  const configPath = resolve(cwd, 'openshop.config.ts')
  let config: import('#types').OpenShopConfig
  try {
    const mod = await import(configPath)
    config = mod.default ?? mod
  } catch (error) {
    console.error(`[openshop] Failed to load ${configPath}`)
    console.error(error)
    process.exit(1)
  }

  console.log(`[openshop] Loaded config: ${Object.keys(config.flows).length} flows`)

  const { Worker } = await import('#engine/worker')
  const worker = new Worker(config, { concurrency: opts.concurrency })
  await worker.start()

  const shutdown = async () => {
    await worker.stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
