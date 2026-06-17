import type { OpenShopConfig, FlowDefinition, FlowRunContext, ProviderDefinition, ProviderFieldDef, ProviderFieldDefinitions, ProviderMethod, ConfigFromFields, WebhookDefinition, CronEntryFor, RetryPolicy, WorkerConfig, FunctionDefinition, AnyFunctionDefinition, FunctionOwner, ShopifyFunctionType, DiscountMode, ProxyDefinition, ShopifyConfig, ShopifyAppConfig, ConnectorsFromProviders } from './types.ts'
import type { Type } from 'arktype'
import type { StandardCRON } from 'ts-cron-validator'
import { validateOpenShopConfig } from './config/validate.ts'

interface OpenShopAppBase<TProviders extends Record<string, ProviderDefinition>> {
  shopify?: ShopifyConfig
  providers: TProviders
  worker?: Partial<WorkerConfig>
  retryPolicy?: Partial<RetryPolicy>
  onError?: (error: Error, context?: { flow?: string; step?: string }) => Promise<void> | void
}

type AppFlowRunContext<
  TInput,
  TProviders extends Record<string, ProviderDefinition>,
> = FlowRunContext<TInput, ConnectorsFromProviders<TProviders>>

interface FlowInput<TInput, TProviders extends Record<string, ProviderDefinition>> {
  name: string
  input?: Type<TInput>
  timeout?: number
  stepTimeout?: number
  concurrency?: 'reject' | 'allow'
  retryPolicy?: Partial<RetryPolicy>
  run: (ctx: AppFlowRunContext<TInput, TProviders>) => Promise<void>
}

interface OpenShopConfigInput<
  TProviders extends Record<string, ProviderDefinition>,
  TFlows extends Record<string, FlowDefinition<unknown>>,
  TFunctions extends Record<string, AnyFunctionDefinition>,
> {
  shopify?: ShopifyConfig
  flows: TFlows
  functions?: TFunctions
  webhooks?: Record<string, WebhookDefinition>
  crons?: CronEntryFor<TFlows>[]
  worker?: Partial<WorkerConfig>
  retryPolicy?: Partial<RetryPolicy>
  onError?: (error: Error, context?: { flow?: string; step?: string }) => Promise<void> | void
}

export interface OpenShopApp<TProviders extends Record<string, ProviderDefinition>> {
  defineFlow<TInput = Record<string, unknown>>(flow: FlowInput<TInput, TProviders>): FlowDefinition<TInput>
  defineFunction<const TFields extends ProviderFieldDefinitions>(fn: {
    type: ShopifyFunctionType
    handle: string
    modes?: DiscountMode[]
    owner?: FunctionOwner<ConfigFromFields<TFields>>
    config: TFields
  }): FunctionDefinition<TFields>
  defineProxy(proxy: ProxyDefinition): ProxyDefinition
  defineWebhook(webhook: WebhookDefinition): WebhookDefinition
  defineConfig<
    const TFlows extends Record<string, FlowDefinition<unknown>>,
    const TFunctions extends Record<string, AnyFunctionDefinition> = Record<string, AnyFunctionDefinition>,
  >(config: OpenShopConfigInput<TProviders, TFlows, TFunctions>): OpenShopConfig<TProviders, TFlows, TFunctions>
}

function validateConfig<
  const TProviders extends Record<string, ProviderDefinition>,
  const TFlows extends Record<string, FlowDefinition<unknown>>,
  const TFunctions extends Record<string, AnyFunctionDefinition> = Record<string, AnyFunctionDefinition>,
>(config: OpenShopConfig<TProviders, TFlows, TFunctions>): OpenShopConfig<TProviders, TFlows, TFunctions> {
  validateOpenShopConfig(config as unknown as OpenShopConfig)
  return config
}

/**
 * Define an OpenShop app. The app carries provider types into flows and config.
 */
export function defineOpenShop<const TProviders extends Record<string, ProviderDefinition>>(
  app: OpenShopAppBase<TProviders>,
): OpenShopApp<TProviders> {
  return {
    defineFlow<TInput = Record<string, unknown>>(flow: FlowInput<TInput, TProviders>): FlowDefinition<TInput> {
      return flow as unknown as FlowDefinition<TInput>
    },
    defineFunction<const TFields extends ProviderFieldDefinitions>(fn: {
      type: ShopifyFunctionType
      handle: string
      modes?: DiscountMode[]
      owner?: FunctionOwner<ConfigFromFields<TFields>>
      config: TFields
    }): FunctionDefinition<TFields> {
      return fn
    },
    defineProxy(proxy: ProxyDefinition): ProxyDefinition {
      return proxy
    },
    defineWebhook(webhook: WebhookDefinition): WebhookDefinition {
      return webhook
    },
    defineConfig<
      const TFlows extends Record<string, FlowDefinition<unknown>>,
      const TFunctions extends Record<string, AnyFunctionDefinition> = Record<string, AnyFunctionDefinition>,
    >(config: OpenShopConfigInput<TProviders, TFlows, TFunctions>): OpenShopConfig<TProviders, TFlows, TFunctions> {
      return validateConfig({
        ...app,
        ...config,
        shopify: config.shopify ?? app.shopify,
        providers: app.providers,
        worker: config.worker ?? app.worker,
        retryPolicy: config.retryPolicy ?? app.retryPolicy,
        onError: config.onError ?? app.onError,
      })
    },
  }
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
 * Define a provider. Identity function for type inference.
 */
export function defineProvider<
  const TFields extends ProviderFieldDefinitions,
  TMethods extends Record<string, ProviderMethod<ConfigFromFields<TFields>, never[], unknown>>,
>(provider: {
  name: string
  ui: { fields: TFields }
  transformer?: (data: { data: Record<string, unknown> }) => Record<string, unknown>
  checker?: (ctx: { config: ConfigFromFields<TFields> }) => Promise<boolean>
  methods: TMethods
}): ProviderDefinition<TFields, TMethods> {
  return provider as ProviderDefinition<TFields, TMethods>
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
  ShopifyConfig,
  ShopifyAppConfig,
  ConnectorsFromProviders,
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
export { createShopifyClient } from './shopify/client.ts'
export { setRuntimeLogger, getRuntimeLogger, type RuntimeLogger } from './runtime/logger.ts'
