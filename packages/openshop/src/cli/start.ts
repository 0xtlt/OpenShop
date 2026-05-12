import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { migrateSchema } from './schema.js'
import { closeHttpServer } from '#server/http'

export async function startProd() {
  const cwd = process.cwd()
  const port = Number(process.env.PORT) || 3000

  console.log('[openshop] Starting production server...')

  process.env.DATABASE_URL ??= 'postgresql://openshop:openshop@localhost:5432/openshop'

  try {
    await migrateSchema(cwd, { silent: true })
  } catch {
    console.error('[openshop] Database migration failed')
    process.exit(1)
  }
  console.log('[openshop] Database migrations applied')

  const { startApiServer } = await import('#server/index')
  const { startScheduler, stopScheduler } = await import('#engine/scheduler')

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

  console.log(`[openshop] Loaded config: ${Object.keys(config.flows).length} flows, ${Object.keys(config.providers).length} providers`)

  const staticDir = resolve(cwd, 'dist', 'ui')
  if (!existsSync(staticDir)) {
    console.error('[openshop] dist/ui not found. Run `openshop build` first.')
    process.exit(1)
  }

  const server = await startApiServer(config, port, staticDir)
  startScheduler(config)

  const shutdown = async () => {
    console.log('[openshop] Shutting down...')
    try {
      await closeHttpServer(server)
      stopScheduler()
      process.exit(0)
    } catch (error) {
      console.error('[openshop] Failed to close HTTP server:', error)
      process.exit(1)
    }
  }
  process.on('SIGTERM', () => { void shutdown() })
  process.on('SIGINT', () => { void shutdown() })

  console.log(`[openshop] Production server running on http://localhost:${port}`)
}
