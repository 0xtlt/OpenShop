import type { OpenShopConfig, FlowDefinition, FlowRunContext, ProviderDefinition, ProviderFieldDef, ConfigFromFields, WebhookDefinition, CronEntryFor, RetryPolicy, WorkerConfig, CronEntry, FunctionDefinition, FunctionOwner, ShopifyFunctionType, DiscountMode, ProxyDefinition, ProxyContext } from './types.ts'
import type { Type } from 'arktype'
import type { StandardCRON } from 'ts-cron-validator'

/**
 * Define a OpenShop config. Flow names autocomplete in crons, input is type-checked.
 */
export function defineConfig<
  const TProviders extends Record<string, ProviderDefinition<any, any>>,
  const TFlows extends Record<string, FlowDefinition<any>>,
  const TFunctions extends Record<string, FunctionDefinition<any>> = Record<string, FunctionDefinition<any>>,
>(config: {
  providers: TProviders
  flows: TFlows
  functions?: TFunctions
  webhooks?: Record<string, WebhookDefinition>
  crons?: CronEntryFor<TFlows>[]
  worker?: Partial<WorkerConfig>
  retryPolicy?: Partial<RetryPolicy>
  onError?: (error: Error, context?: { flow?: string; step?: string }) => Promise<void> | void
}): OpenShopConfig<TProviders, TFlows, TFunctions> {
  return config as OpenShopConfig<TProviders, TFlows, TFunctions>
}

/** Standard cron nicknames supported by croner */
type CronNickname = '@yearly' | '@annually' | '@monthly' | '@weekly' | '@daily' | '@hourly'

/**
 * Validate a cron schedule at compile-time. Returns the string as-is at runtime.
 * Supports standard 5-field expressions and croner nicknames (@daily, @hourly, etc.)
 *
 * @example
 *   cron('0 3 * * *')   // ✓ compiles
 *   cron('@daily')      // ✓ compiles
 *   cron('0 3 * e* *')  // ✗ type error
 *   cron('60 3 * * *')  // ✗ type error (minutes 0-59)
 */
export function cron<T extends string>(schedule: T extends CronNickname ? T : StandardCRON<T> extends never ? never : T): T {
  return schedule
}

/**
 * Define a flow. If `input` is an ArkType schema, ctx.input is typed + validated at runtime.
 */
export function defineFlow<TInput = Record<string, unknown>>(flow: {
  name: string
  input?: Type<TInput>
  timeout?: number
  stepTimeout?: number
  concurrency?: 'reject' | 'allow'
  retryPolicy?: Partial<RetryPolicy>
  run: (ctx: FlowRunContext<TInput>) => Promise<void>
}): FlowDefinition<TInput> {
  return flow
}

/**
 * Define a provider. Identity function for type inference.
 */
export function defineProvider<
  const TFields extends Record<string, ProviderFieldDef<any>>,
  TMethods extends Record<string, (config: ConfigFromFields<TFields>, ...args: any[]) => any>,
>(provider: {
  name: string
  ui: { fields: TFields }
  transformer?: (data: { data: Record<string, unknown> }) => Record<string, unknown>
  checker?: (ctx: { config: ConfigFromFields<TFields> }) => Promise<boolean>
  methods: TMethods
}): ProviderDefinition<TFields, TMethods> {
  return provider as ProviderDefinition<TFields, TMethods>
}

/**
 * Define a Shopify Function management config (UI + mutations, not the WASM code).
 */
export function defineFunction<const TFields extends Record<string, ProviderFieldDef<any>>>(fn: {
  type: ShopifyFunctionType
  handle: string
  modes?: DiscountMode[]
  owner?: FunctionOwner<ConfigFromFields<TFields>>
  config: TFields
}): FunctionDefinition<TFields> {
  return fn
}

/**
 * Define an app proxy route handler (file-based routing in proxy/ directory).
 */
export function defineProxy(proxy: ProxyDefinition): ProxyDefinition {
  return proxy
}

/**
 * Define a webhook handler.
 */
export function defineWebhook(webhook: WebhookDefinition): WebhookDefinition {
  return webhook
}

// Re-export types
export type {
  OpenShopConfig,
  FlowDefinition,
  FlowRunContext,
  ProviderDefinition,
  ProviderFieldDef,
  ProviderInstance,
  WebhookDefinition,
  WebhookContext,
  StepFn,
  Logger,
  CronEntry,
  CronEntryFor,
  FunctionDefinition,
  ShopifyFunctionType,
  ConnectorOf,
  ProxyDefinition,
  ProxyContext,
} from './types.ts'

export type { ShopifyClient } from './shopify/client.ts'
export type { RetryPolicy, WorkerConfig, DispatchOptions } from './types.ts'
export { dispatchFlow } from './engine/dispatch.ts'
export { defineModel } from './db/schema.ts'
export { getDb } from './db/client.ts'
