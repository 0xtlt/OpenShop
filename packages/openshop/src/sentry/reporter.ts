import { FlowCanceledError, SleepSignal } from '../engine/errors.ts'

export type SentryMechanism =
  | 'flow'
  | 'webhook'
  | 'http'
  | 'proxy'
  | 'route'
  | 'worker'
  | 'scheduler'
  | 'cli'

export interface ExceptionContext {
  mechanism: SentryMechanism
  flow?: string
  shop?: string
  shopifyApp?: string
  topic?: string
  route?: string
  method?: string
  willRetry?: boolean
}

export interface ExceptionReporter {
  captureException(error: unknown, context: ExceptionContext): void
  flush?(timeoutMs?: number): Promise<boolean>
  close?(timeoutMs?: number): Promise<boolean>
  setTag?(key: string, value: string): void
}

const noopReporter: ExceptionReporter = {
  captureException() {},
}

let reporter: ExceptionReporter = noopReporter

export function setExceptionReporter(next: ExceptionReporter): ExceptionReporter {
  const previous = reporter
  reporter = next
  return previous
}

export function resetSentryReporter(): void {
  reporter = noopReporter
}

export function getExceptionReporter(): ExceptionReporter {
  return reporter
}

export function shouldIgnoreException(error: unknown): boolean {
  return error instanceof FlowCanceledError || error instanceof SleepSignal
}

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export function captureException(error: unknown, context: ExceptionContext): void {
  if (shouldIgnoreException(error)) return
  reporter.captureException(toError(error), context)
}

export const captureOpenShopException = captureException
