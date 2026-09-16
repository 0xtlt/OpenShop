import { captureException, flush, init, isInitialized, sentry, withScope } from '@sentry/hono/node'
import type { Env, Hono } from 'hono'
import type { OpenShopConfig } from '../types.ts'
import { getRuntimeLogger } from './logger.ts'

type SentryTagValue = string | number | boolean

export interface SentryExceptionContext {
  operation: 'flow' | 'worker' | 'cron' | 'error-hook'
  tags?: Record<string, SentryTagValue | undefined>
  extra?: Record<string, unknown>
}

/**
 * Initialize Sentry for the current process when the app opted in.
 * The SDK itself owns idempotency when an application initialized it earlier.
 */
export function initializeSentry(config: OpenShopConfig): boolean {
  if (!config.sentry) return false
  if (!isInitialized()) init(config.sentry)
  return true
}

/** Install request tracing and unhandled HTTP error capture on a Hono app. */
export function installSentryMiddleware<E extends Env>(app: Hono<E>, config: OpenShopConfig): boolean {
  if (!initializeSentry(config)) return false
  app.use('*', sentry(app))
  return true
}

/** Report a caught framework error without changing its control flow. */
export function captureSentryException(
  config: OpenShopConfig,
  error: unknown,
  context: SentryExceptionContext,
): void {
  try {
    if (!initializeSentry(config)) return

    withScope((scope) => {
      scope.setTag('openshop.operation', context.operation)
      for (const [key, value] of Object.entries(context.tags ?? {})) {
        if (value !== undefined) scope.setTag(`openshop.${key}`, value)
      }
      if (context.extra) scope.setContext('openshop', context.extra)
      captureException(error)
    })
  } catch (sentryError) {
    getRuntimeLogger().warn('[openshop] Failed to report an error to Sentry', { error: sentryError })
  }
}

/** Flush queued events during graceful process shutdown. */
export async function flushSentry(config: OpenShopConfig, timeoutMs = 2_000): Promise<boolean> {
  if (!config.sentry || !isInitialized()) return true
  try {
    return await flush(timeoutMs)
  } catch (error) {
    getRuntimeLogger().warn('[openshop] Failed to flush Sentry events', { error })
    return false
  }
}
