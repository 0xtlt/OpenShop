import type { MiddlewareHandler } from 'hono'
import { captureException } from './reporter.ts'
import { withSentryIsolation } from './init.ts'

export function sentryIsolationMiddleware(): MiddlewareHandler {
  return async (_c, next) => {
    await withSentryIsolation(() => next())
  }
}

export function sentryUnhandledErrorHandler(error: unknown, path: string): void {
  captureException(error, { mechanism: 'http', route: path })
}
