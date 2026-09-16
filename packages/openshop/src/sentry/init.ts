import type { SentryConfig } from '../types.ts'
import type { OpenShopSentryProcess } from './options.ts'
import { resolveSentryEnvOptions } from './options.ts'
import {
  captureException,
  getExceptionReporter,
  resetSentryReporter,
  setExceptionReporter,
  type ExceptionContext,
  type ExceptionReporter,
} from './reporter.ts'
import { scrubSentryEvent } from './scrub.ts'

export interface InitOpenShopSentryOptions {
  process?: OpenShopSentryProcess
}

interface SentryScope {
  setTag(key: string, value: string): void
  setContext(name: string, context: Record<string, unknown>): void
}

export interface OpenShopSentrySdk {
  init(options: Record<string, unknown>): void
  withScope(callback: (scope: SentryScope) => void): void
  withIsolationScope<T>(callback: () => T): T
  captureException(error: unknown): string
  flush(timeout?: number): Promise<boolean>
  close(timeout?: number): Promise<boolean>
  getGlobalScope(): { setTag(key: string, value: string): void }
}

type SentrySdkLoader = () => Promise<OpenShopSentrySdk>

let loadSdk: SentrySdkLoader = async () => await import('@sentry/node') as OpenShopSentrySdk
let sdk: OpenShopSentrySdk | null = null
let initialized = false

export function setSentrySdkLoader(loader: SentrySdkLoader): void {
  loadSdk = loader
}

export function isOpenShopSentryEnabled(): boolean {
  return sdk !== null
}

export async function initOpenShopSentry(options: InitOpenShopSentryOptions = {}): Promise<boolean> {
  if (initialized) return sdk !== null
  initialized = true

  const resolved = resolveSentryEnvOptions()
  if (!resolved.enabled || !resolved.dsn) return false

  const loaded = await loadSdk()
  sdk = loaded
  loaded.init({
    dsn: resolved.dsn,
    environment: resolved.environment,
    release: resolved.release,
    tracesSampleRate: resolved.tracesSampleRate,
    sendDefaultPii: false,
    initialScope: {
      tags: {
        'openshop.process': options.process ?? 'web',
      },
    },
    beforeSend(event: Record<string, unknown>) {
      return scrubSentryEvent(event)
    },
  })
  setExceptionReporter(createSdkReporter(loaded))
  return true
}

export function applySentryConfig(config: SentryConfig | undefined): void {
  if (!config) return
  if (config.enabled === false) {
    const closing = getExceptionReporter()
    sdk = null
    resetSentryReporter()
    void closing.close?.(2_000)
    return
  }

  const current = getExceptionReporter()
  for (const [key, value] of Object.entries(config.tags ?? {})) {
    current.setTag?.(key, value)
  }
}

export async function flushOpenShopSentry(timeoutMs = 2_000): Promise<void> {
  await getExceptionReporter().flush?.(timeoutMs)
}

export async function closeOpenShopSentry(timeoutMs = 2_000): Promise<void> {
  await getExceptionReporter().close?.(timeoutMs)
  sdk = null
  resetSentryReporter()
}

export async function withSentryIsolation<T>(fn: () => Promise<T> | T): Promise<T> {
  if (!sdk) return await fn()
  return await sdk.withIsolationScope(fn)
}

export function resetOpenShopSentryForTests(): void {
  initialized = false
  sdk = null
  loadSdk = async () => await import('@sentry/node') as OpenShopSentrySdk
  resetSentryReporter()
}

function createSdkReporter(Sentry: OpenShopSentrySdk): ExceptionReporter {
  return {
    captureException(error, context) {
      Sentry.withScope((scope) => {
        applyExceptionContext(scope, context)
        Sentry.captureException(error)
      })
    },
    flush(timeoutMs) {
      return Sentry.flush(timeoutMs)
    },
    close(timeoutMs) {
      return Sentry.close(timeoutMs)
    },
    setTag(key, value) {
      Sentry.getGlobalScope().setTag(key, value)
    },
  }
}

function applyExceptionContext(scope: SentryScope, context: ExceptionContext): void {
  scope.setTag('openshop.mechanism', context.mechanism)
  if (context.flow) scope.setTag('flow', context.flow)
  if (context.shop) scope.setTag('shop', context.shop)
  if (context.shopifyApp) scope.setTag('shopifyApp', context.shopifyApp)
  if (context.topic) scope.setTag('topic', context.topic)
  if (context.route) scope.setTag('http.route', context.route)
  if (context.method) scope.setTag('http.method', context.method)
  if (context.willRetry !== undefined) scope.setTag('willRetry', String(context.willRetry))
  scope.setContext('openshop', { ...context })
}

export { captureException }
