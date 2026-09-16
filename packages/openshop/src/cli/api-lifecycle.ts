import type { ServerType } from '@hono/node-server'
import { closeHttpServer } from '#server/http'

interface CreateApiShutdownHandlerOptions {
  server: ServerType
  stopScheduler: () => void
  stopWorker: () => Promise<void>
  flushErrorReporter?: () => Promise<unknown>
  notifyListenerClosed?: () => void
  listenerCloseTimeoutMs?: number
}

export function createApiShutdownHandler(options: CreateApiShutdownHandlerOptions) {
  let shutdownPromise: Promise<void> | null = null

  return async function shutdownApiProcess(): Promise<void> {
    if (shutdownPromise) return shutdownPromise

    shutdownPromise = (async () => {
      try {
        await closeHttpServer(options.server, options.listenerCloseTimeoutMs)
        options.notifyListenerClosed?.()
        options.stopScheduler()
        await options.stopWorker()
      } finally {
        await options.flushErrorReporter?.()
      }
    })()

    return shutdownPromise
  }
}
