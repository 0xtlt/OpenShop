export type OpenShopSentryProcess = 'web' | 'worker' | 'dev'

export interface ResolvedSentryOptions {
  dsn: string | undefined
  enabled: boolean
  environment: string
  release: string | undefined
  tracesSampleRate: number
}

export function parseTracesSampleRate(value: string | undefined): number {
  if (!value?.trim()) return 0
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  if (parsed > 1) return 1
  return parsed
}

export function resolveSentryEnvOptions(env: NodeJS.Dict<string> = process.env): ResolvedSentryOptions {
  const dsn = env.SENTRY_DSN?.trim() || undefined
  const enabledFlag = env.SENTRY_ENABLED?.trim().toLowerCase()
  const enabled = Boolean(dsn) && enabledFlag !== 'false' && enabledFlag !== '0'

  return {
    dsn,
    enabled,
    environment: env.SENTRY_ENVIRONMENT?.trim() || env.NODE_ENV?.trim() || 'development',
    release: env.SENTRY_RELEASE?.trim() || undefined,
    tracesSampleRate: parseTracesSampleRate(env.SENTRY_TRACES_SAMPLE_RATE),
  }
}
