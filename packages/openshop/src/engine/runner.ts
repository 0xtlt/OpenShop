import { type } from 'arktype'
import { eq, and } from 'drizzle-orm'
import { getDb } from '#db/client'
import { flowRuns, logs, providerConfigs } from '#db/schema'
import { createStepExecutor } from '#engine/step'
import { registerAbort, cleanupAbort } from '#engine/abort'
import { computeNextRetryAt } from '#engine/backoff'
import { FlowCanceledError, FlowTimeoutError, SleepSignal } from '#engine/errors'
import { decryptConfig } from '#server/crypto'
import { createShopifyClient } from '../shopify/client.ts'
import type { OpenShopConfig, Logger, RetryPolicy } from '#types'

export interface RunFlowOptions {
  runId: string
  flowName: string
  input?: Record<string, unknown>
  config: OpenShopConfig
  shop: string
  workerId?: string
  attempt?: number
  onHeartbeat?: () => Promise<void>
  connectors?: OpenShopConnectors
}

export type RunFlowResult =
  | { status: 'completed' }
  | { status: 'sleeping'; resumeAt: Date }
  | { status: 'failed'; error: string; willRetry: boolean }
  | { status: 'canceled' }
  | { status: 'lease_lost' }

export async function runFlow(opts: RunFlowOptions): Promise<RunFlowResult> {
  const { runId, flowName, input = {}, config, shop, onHeartbeat, workerId } = opts
  const db = getDb()
  const flow = config.flows[flowName]

  if (!flow) {
    throw new Error(`Flow "${flowName}" not found. Available: ${Object.keys(config.flows).join(', ')}`)
  }

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  if (onHeartbeat) {
    heartbeatTimer = setInterval(async () => {
      try { await onHeartbeat() } catch { /* lease extension failed */ }
    }, 15_000)
  }

  const signal = registerAbort(runId)
  const logger = createLogger(db, runId)
  const attempt = opts.attempt ?? await resolveRunAttempt(runId)
  const ownedRun = workerId
    ? and(eq(flowRuns.id, runId), eq(flowRuns.workerId, workerId), eq(flowRuns.status, 'running'))
    : eq(flowRuns.id, runId)
  const step = createStepExecutor(db, runId, logger, signal, flow.stepTimeout, attempt)
  const connectors = opts.connectors ?? await buildConnectors(config, shop)
  const shopify = await createShopifyClient(shop)

  try {
    let validatedInput = input
    if (flow.input) {
      const result = flow.input(input)
      if (result instanceof type.errors) {
        throw new Error(`Invalid input for flow "${flowName}": ${result.summary}`)
      }
      validatedInput = result
    }

    logger.info({ flowName }, `Flow "${flowName}" started`)

    if (flow.timeout) {
      await Promise.race([
        flow.run({ input: validatedInput, connectors, shopify, shop, step, logger, db }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new FlowTimeoutError(flowName, flow.timeout!)), flow.timeout),
        ),
      ])
    } else {
      await flow.run({ input: validatedInput, connectors, shopify, shop, step, logger, db })
    }

    const completed = await db.update(flowRuns)
      .set({ status: 'completed', completedAt: new Date(), workerId: null })
      .where(ownedRun)
      .returning({ id: flowRuns.id })
    if (completed.length === 0) return { status: 'lease_lost' }

    logger.info({ flowName }, `Flow "${flowName}" completed`)
    return { status: 'completed' }

  } catch (error: unknown) {
    if (error instanceof SleepSignal) {
      const sleeping = await db.update(flowRuns)
        .set({ status: 'sleeping', availableAt: error.resumeAt, workerId: null })
        .where(ownedRun)
        .returning({ id: flowRuns.id })
      if (sleeping.length === 0) return { status: 'lease_lost' }
      logger.info({ flowName, resumeAt: error.resumeAt.toISOString() }, `Flow "${flowName}" sleeping`)
      return { status: 'sleeping', resumeAt: error.resumeAt }
    }

    const isCanceled = error instanceof FlowCanceledError || signal.aborted
    if (isCanceled) {
      const canceled = await db.update(flowRuns)
        .set({ status: 'canceled', completedAt: new Date(), workerId: null })
        .where(ownedRun)
        .returning({ id: flowRuns.id })
      if (canceled.length === 0) return { status: 'lease_lost' }
      logger.info({ flowName }, `Flow "${flowName}" was canceled`)
      return { status: 'canceled' }
    }

    const errorMessage = error instanceof Error ? error.message : String(error)

    const [run] = await db.select({ attempts: flowRuns.attempts, deadlineAt: flowRuns.deadlineAt, retryPolicy: flowRuns.retryPolicy })
      .from(flowRuns)
      .where(eq(flowRuns.id, runId))
      .limit(1)

    const retryPolicy = run?.retryPolicy as RetryPolicy | null

    let willRetry = false
    if (retryPolicy && run) {
      const nextAt = computeNextRetryAt(run.attempts, retryPolicy, run.deadlineAt)
      if (nextAt) {
        willRetry = true
        const retrying = await db.update(flowRuns)
          .set({ status: 'pending', error: errorMessage, availableAt: nextAt, workerId: null })
          .where(ownedRun)
          .returning({ id: flowRuns.id })
        if (retrying.length === 0) return { status: 'lease_lost' }
      }
    }

    if (!willRetry) {
      const failed = await db.update(flowRuns)
        .set({ status: 'failed', error: errorMessage, completedAt: new Date(), workerId: null })
        .where(ownedRun)
        .returning({ id: flowRuns.id })
      if (failed.length === 0) return { status: 'lease_lost' }
    }

    logger.error({ flowName, error: errorMessage, willRetry }, `Flow "${flowName}" failed: ${errorMessage}`)

    if (config.onError) {
      try {
        await config.onError(error instanceof Error ? error : new Error(errorMessage), { flow: flowName })
      } catch { /* Don't crash */ }
    }

    return { status: 'failed', error: errorMessage, willRetry }

  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    cleanupAbort(runId)
  }
}

async function resolveRunAttempt(runId: string): Promise<number> {
  const db = getDb()
  const [run] = await db.select({ attempts: flowRuns.attempts })
    .from(flowRuns)
    .where(eq(flowRuns.id, runId))
    .limit(1)
  return run?.attempts && run.attempts > 0 ? run.attempts : 1
}

function createLogger(db: ReturnType<typeof getDb>, flowRunId: string): Logger {
  const log = (level: 'info' | 'warn' | 'error') => {
    return (payload: Record<string, unknown>, message?: string) => {
      const line = `[${level.toUpperCase()}] ${message ?? ''}`
      if (level === 'error') console.error(line, payload)
      else console.log(line, payload)

      db.insert(logs).values({
        flowRunId, level, message: message ?? '', payload,
      }).catch(() => { /* log write failed — don't crash the flow */ })
    }
  }
  return { info: log('info'), warn: log('warn'), error: log('error') }
}

async function buildConnectors(config: OpenShopConfig, shop: string): Promise<OpenShopConnectors> {
  const connectors: Record<string, Record<string, (...args: unknown[]) => unknown>> = {}
  const db = getDb()

  for (const [name, provider] of Object.entries(config.providers)) {
    const [stored] = await db.select({ config: providerConfigs.config })
      .from(providerConfigs)
      .where(and(eq(providerConfigs.shop, shop), eq(providerConfigs.providerName, name)))
      .limit(1)
    const providerConfig = decryptConfig(stored?.config)

    const connector: Record<string, (...args: unknown[]) => unknown> = {}
    for (const methodName of Object.keys(provider.methods)) {
      const methodFn = provider.methods[methodName]
      connector[methodName] = (...args: unknown[]) => methodFn(providerConfig, ...args)
    }
    connectors[name] = connector
  }
  return connectors as unknown as OpenShopConnectors
}
