import { getDb } from '../db/client.ts'
import { flowRuns } from '../db/schema.ts'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { resolveRetryPolicy } from './backoff.ts'
import { FlowConcurrencyError } from './errors.ts'
import type { OpenShopConfig, DispatchOptions } from '../types.ts'

export interface DispatchFlowParams {
  flowName: string
  input?: Record<string, unknown>
  config: OpenShopConfig
  shop: string
  parentRunId?: string
  options?: DispatchOptions
}

export async function dispatchFlow(params: DispatchFlowParams) {
  const { flowName, input = {}, config, shop, parentRunId, options } = params
  const db = getDb()
  const flow = config.flows[flowName]

  if (!flow) {
    throw new Error(`Flow "${flowName}" not found. Available: ${Object.keys(config.flows).join(', ')}`)
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${shop}:${flowName}`}))`)

    const concurrency = flow.concurrency ?? 'reject'
    if (concurrency === 'reject') {
      const existing = await tx.select({ id: flowRuns.id })
        .from(flowRuns)
        .where(and(
          eq(flowRuns.shop, shop),
          eq(flowRuns.flowName, flowName),
          inArray(flowRuns.status, ['pending', 'running', 'sleeping']),
        ))
        .limit(1)

      if (existing.length > 0) {
        throw new FlowConcurrencyError(flowName, shop, existing[0].id)
      }
    }

    const deadlineAt = flow.timeout ? new Date(Date.now() + flow.timeout) : null
    const retryPolicy = resolveRetryPolicy(config.retryPolicy, flow.retryPolicy, options?.retryPolicy)
    const availableAt = new Date(Date.now() + (options?.delayMs ?? 0))

    const [run] = await tx.insert(flowRuns).values({
      shop,
      flowName,
      status: 'pending',
      input,
      deadlineAt,
      parentRunId,
      retryPolicy,
      availableAt,
    }).returning({ id: flowRuns.id })

    return { runId: run.id, status: 'pending' as const }
  })
}
