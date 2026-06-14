import { loadBuiltConfig, resolveBuiltConfig } from './app-build.ts'

export async function startWorker(opts: { concurrency?: number } = {}) {
  const cwd = process.cwd()

  console.log('[openshop] Starting worker...')

  process.env.DATABASE_URL ??= 'postgresql://openshop:openshop@localhost:5432/openshop'
  console.log('[openshop] Database migrations are manual. Run `openshop migrate` before starting production processes.')

  let config: import('#types').OpenShopConfig
  try {
    config = await loadBuiltConfig(cwd)
  } catch (error) {
    console.error(`[openshop] Failed to load ${resolveBuiltConfig(cwd)}`)
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
