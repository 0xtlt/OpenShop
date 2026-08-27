import { getDb } from '../db/client.ts'
import { flowRuns } from '../db/schema.ts'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { resolveRetryPolicy } from './backoff.ts'
import { FlowConcurrencyError } from './errors.ts'
import { DEFAULT_SHOPIFY_APP_HANDLE } from '#server/shopify-apps'
import type {
  AnyFunctionDefinition,
  DispatchOptions,
  FlowDefinition,
  OpenShopConfig,
  ProviderDefinition,
} from '../types.ts'

type InputFor<TFlow> = TFlow extends FlowDefinition<infer TInput>
  ? TInput
  : Record<string, unknown>

export interface ConfigDispatchFlowParams<
  TFlows extends Record<string, FlowDefinition<unknown>>,
  TFlowName extends keyof TFlows & string,
> {
  flowName: TFlowName
  input?: InputFor<TFlows[TFlowName]>
  shop: string
  shopifyApp?: string
  parentRunId?: string
  options?: DispatchOptions
}

export interface DispatchFlowParams<
  TProviders extends Record<string, ProviderDefinition> = Record<string, ProviderDefinition>,
  TFlows extends Record<string, FlowDefinition<unknown>> = Record<string, FlowDefinition<unknown>>,
  TFunctions extends Record<string, AnyFunctionDefinition> = Record<string, AnyFunctionDefinition>,
  TFlowName extends keyof TFlows & string = keyof TFlows & string,
> extends ConfigDispatchFlowParams<TFlows, TFlowName> {
  config: OpenShopConfig<TProviders, TFlows, TFunctions>
}

export interface DispatchFlowResult {
  runId: string
  status: 'pending'
}

export async function dispatchFlow<
  const TProviders extends Record<string, ProviderDefinition>,
  const TFlows extends Record<string, FlowDefinition<unknown>>,
  const TFunctions extends Record<string, AnyFunctionDefinition>,
  const TFlowName extends keyof TFlows & string,
>(params: DispatchFlowParams<TProviders, TFlows, TFunctions, TFlowName>): Promise<DispatchFlowResult> {
  const { flowName, input = {}, config, shop, parentRunId, options } = params
  const shopifyApp = params.shopifyApp ?? DEFAULT_SHOPIFY_APP_HANDLE
  const db = getDb()
  const flow = Object.hasOwn(config.flows, flowName)
    ? config.flows[flowName]
    : undefined

  if (!flow) {
    throw new Error(`Flow "${flowName}" not found. Available: ${Object.keys(config.flows).join(', ')}`)
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${shopifyApp}:${shop}:${flowName}`}))`)

    const concurrency = flow.concurrency ?? 'reject'
    if (concurrency === 'reject') {
      const existing = await tx.select({ id: flowRuns.id })
        .from(flowRuns)
        .where(and(
          eq(flowRuns.appHandle, shopifyApp),
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
      appHandle: shopifyApp,
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
