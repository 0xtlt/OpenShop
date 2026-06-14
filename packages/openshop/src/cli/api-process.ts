/**
 * API server subprocess — spawned by dev.ts.
 * Each spawn gets a fresh module cache, solving ESM hot-reload.
 */
import { resolve } from 'node:path'
import { createApiShutdownHandler } from './api-lifecycle.ts'
import { loadEnvFile } from './env.ts'

const cwd = process.cwd()
loadEnvFile(cwd)

const apiPort = Number(process.env.OPENSHOP_API_PORT) || 3001
process.env.DATABASE_URL ??= 'postgresql://openshop:openshop@localhost:5432/openshop'

// Load config (fresh module cache each spawn)
const configPath = resolve(cwd, 'openshop.config.ts')
const mod = await import(configPath)
const config = mod.default ?? mod

// Start API server
const { startApiServer } = await import('#server/index')
const server = await startApiServer(config, apiPort)

// Start worker
const { Worker } = await import('#engine/worker')
const worker = new Worker(config)
worker.start()

// Start scheduler
const { startScheduler, stopScheduler } = await import('#engine/scheduler')
startScheduler(config)

// Signal parent that we're ready
process.send?.('ready')

// Graceful shutdown
const shutdown = createApiShutdownHandler({
  server,
  stopScheduler,
  stopWorker: () => worker.stop(),
  notifyListenerClosed: () => process.send?.('listener-closed'),
})

process.on('SIGTERM', () => {
  void shutdown()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('[openshop] API process shutdown failed:', error)
      process.exit(1)
    })
})
