import { type } from 'arktype'
import type {
  AdminActionDefinition,
  AdminLoaderDefinition,
  AdminServerContext,
  JsonValue,
} from '../admin/index.ts'
import { getDb } from '../db/client.ts'
import { createShopifyClient } from '../shopify/client.ts'
import { buildConnectors } from '../server/connectors.ts'
import type { OpenShopConfig } from '../types.ts'

export async function createAdminFunctionTestContext(options: {
  config: OpenShopConfig
  shop?: string
  shopifyApp?: string
  actorId?: string
  params?: Record<string, string>
  requestId?: string
}): Promise<AdminServerContext> {
  const shop = options.shop ?? 'test.myshopify.com'
  const shopifyApp = options.shopifyApp ?? 'default'
  return {
    shop,
    shopifyApp,
    actor: { id: options.actorId ?? 'test-actor', sessionId: 'test-session' },
    params: options.params ?? {},
    db: getDb(),
    shopify: await createShopifyClient(shop, shopifyApp),
    connectors: await buildConnectors(options.config, shop, shopifyApp),
    requestId: options.requestId ?? 'test-request',
  }
}

export async function invokeAdminFunction<
  TInput,
  TOutput extends JsonValue,
  TParams extends Record<string, string>,
>(
  definition:
    | AdminLoaderDefinition<TInput, TOutput, TParams>
    | AdminActionDefinition<TInput, TOutput, TParams>,
  context: AdminServerContext<TParams>,
  input: TInput,
): Promise<TOutput> {
  if (definition.authorize && !(await definition.authorize(context))) {
    throw new Error('Admin function authorization rejected')
  }
  let validatedInput = input
  if (definition.input) {
    const result = definition.input(input)
    if (result instanceof type.errors) throw new Error(result.summary)
    validatedInput = result
  }
  return definition.handler(context, validatedInput as TInput)
}
