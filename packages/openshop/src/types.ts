import type { Type } from 'arktype'

// ─── Global augmentable interfaces for GraphQL codegen ───────────────

declare global {
  /** Augment this interface to get typed query results from codegen */
  interface OpenShopQueries {}
  /** Augment this interface to get typed mutation results from codegen */
  interface OpenShopMutations {}
  /** Augment this interface to get typed connectors in flow context */
  interface OpenShopConnectors {}
}

// ─── Provider ────────────────────────────────────────────────────────

export interface ProviderFieldDef<T = unknown> {
  type: 'text' | 'password' | 'number' | 'select' | 'checkbox'
  label: string
  placeholder?: string
  options?: { label: string; value: string }[] // for select
  required?: boolean
  validate?: Type<T>
}

/** Extracts the inferred type from ProviderFieldDef<T> */
type InferField<F> = F extends ProviderFieldDef<infer T> ? T : unknown
type OptionalFieldKeys<F extends Record<string, ProviderFieldDef<any>>> = {
  [K in keyof F]: F[K] extends { required: false } ? K : never
}[keyof F]
type RequiredFieldKeys<F extends Record<string, ProviderFieldDef<any>>> = Exclude<keyof F, OptionalFieldKeys<F>>

/** Derives a typed config object from the fields' `validate` schemas */
export type ConfigFromFields<F extends Record<string, ProviderFieldDef<any>>> = {
  [K in RequiredFieldKeys<F>]: InferField<F[K]>
} & {
  [K in OptionalFieldKeys<F>]?: InferField<F[K]>
}

export type AnyProviderDefinition = ProviderDefinition<Record<string, ProviderFieldDef<any>>, Record<string, (config: any, ...args: any[]) => any>>
export type AnyFlowDefinition = FlowDefinition<any>
export type AnyFunctionDefinition = FunctionDefinition<Record<string, ProviderFieldDef<any>>>

export type ConnectorsFromProviders<TProviders extends Record<string, ProviderDefinition<any, any>>> = {
  [K in keyof TProviders]: ConnectorOf<TProviders[K]>
}

export interface ProviderDefinition<
  TFields extends Record<string, ProviderFieldDef<any>> = Record<string, ProviderFieldDef>,
  TMethods extends Record<string, (config: any, ...args: any[]) => any> = Record<string, (config: any, ...args: any[]) => any>,
> {
  name: string
  ui: { fields: TFields }
  transformer?: (data: { data: Record<string, unknown> }) => Record<string, unknown>
  checker?: (ctx: { config: ConfigFromFields<TFields> }) => Promise<boolean>
  methods: TMethods
}

/** Strips the config first arg from provider methods to get the connector type */
export type ConnectorOf<P extends ProviderDefinition<any, any>> = {
  [K in keyof P['methods']]: P['methods'][K] extends (config: any, ...args: infer A) => infer R
    ? (...args: A) => R
    : never
}

export interface ProviderInstance {
  definition: ProviderDefinition
  config: Record<string, unknown>
  call: <T = unknown>(method: string, ...args: unknown[]) => Promise<T>
}

// ─── Flow ────────────────────────────────────────────────────────────

export interface StepOptions {
  timeout?: number
}

export interface StepFn {
  <T>(name: string, fn: () => Promise<T> | T, options?: StepOptions): Promise<T>
  sleep(name: string, durationMs: number): Promise<void>
}

export interface Logger {
  info: (payload: Record<string, unknown>, message?: string) => void
  warn: (payload: Record<string, unknown>, message?: string) => void
  error: (payload: Record<string, unknown>, message?: string) => void
}

export interface FlowRunContext<TInput = Record<string, unknown>> {
  input: TInput
  connectors: OpenShopConnectors
  shopify: import('./shopify/client.js').ShopifyClient
  shop: string
  step: StepFn
  logger: Logger
  db: import('drizzle-orm/node-postgres').NodePgDatabase<Record<string, unknown>>
}

export interface FlowDefinition<TInput = Record<string, unknown>> {
  name: string
  input?: Type<TInput>
  timeout?: number
  stepTimeout?: number
  concurrency?: 'reject' | 'allow'
  retryPolicy?: Partial<RetryPolicy>
  run: (ctx: FlowRunContext<TInput>) => Promise<void>
}

// ─── Cron schedule type ──────────────────────────────────────────────

// ─── Config ──────────────────────────────────────────────────────────

export interface CronEntry {
  name?: string
  schedule: string
  flow: string
  input?: Record<string, unknown>
  /**
   * Shop targeting mode:
   * - 'global'           → runs once without shop context (default)
   * - 'all'              → runs once per installed shop
   * - 'shop.myshopify.com'  → runs only for this specific shop
   * - ['a.myshopify.com', 'b.myshopify.com'] → runs for these shops
   */
  shops?: 'global' | 'all' | string | string[]
}

export interface WebhookDefinition {
  run: (ctx: WebhookContext) => Promise<void>
}

export interface WebhookContext {
  topic: string
  shop: string
  payload: unknown
  apiVersion: string
}

/** Typed cron entry — flow name autocompletes, input matches the flow's schema */
export type CronEntryFor<TFlows extends Record<string, FlowDefinition<any>>> = {
  [K in keyof TFlows & string]: {
    name?: string
    schedule: string
    flow: K
    input?: TFlows[K] extends FlowDefinition<infer I> ? I : Record<string, unknown>
    shops?: 'global' | 'all' | string | string[]
  }
}[keyof TFlows & string]


export interface OpenShopConfig<
  TProviders extends Record<string, ProviderDefinition<any, any>> = Record<string, ProviderDefinition<any, any>>,
  TFlows extends Record<string, FlowDefinition<any>> = Record<string, FlowDefinition<any>>,
  TFunctions extends Record<string, FunctionDefinition<any>> = Record<string, FunctionDefinition<any>>,
> {
  providers: TProviders
  flows: TFlows
  functions?: TFunctions
  webhooks?: Record<string, WebhookDefinition>
  crons?: CronEntry[]
  worker?: Partial<WorkerConfig>
  retryPolicy?: Partial<RetryPolicy>
  onError?: (error: Error, context?: { flow?: string; step?: string }) => Promise<void> | void
}

// ─── Shopify Function ────────────────────────────────────────────────

export type ShopifyFunctionType =
  | 'discount'
  | 'cart-transform'
  | 'delivery-customization'
  | 'payment-customization'
  | 'checkout-validation'
  | 'fulfillment-constraints'
  // order-routing has no GraphQL mutations (admin UI only)

export type DiscountMode = 'automatic' | 'code'

export interface CombinesWith {
  productDiscounts?: boolean
  orderDiscounts?: boolean
  shippingDiscounts?: boolean
}

export interface FunctionOwner<TConfig = Record<string, unknown>> {
  title: string | ((config: TConfig) => string)
  // Discount-specific
  startsAt?: boolean
  endsAt?: boolean
  usageLimit?: boolean
  combinesWith?: CombinesWith
  appliesOnEachItem?: boolean
  // Non-discount
  enabled?: boolean
}

export interface FunctionDefinition<TFields extends Record<string, ProviderFieldDef<any>> = Record<string, ProviderFieldDef>> {
  type: ShopifyFunctionType
  handle: string
  modes?: DiscountMode[]
  owner?: FunctionOwner<ConfigFromFields<TFields>>
  config: TFields
}

// ─── App Proxy ──────────────────────────────────────────────────────

export type ProxyResponseType = 'liquid' | 'json' | 'html'

export interface ProxyContext {
  /** Shop domain (from HMAC query param or JWT `dest` claim) */
  shop: string
  /** Customer ID as numeric string (from HMAC `logged_in_customer_id` or JWT `sub` claim). Always trusted. */
  customerId: string | null
  /** Auth source used to establish shop/customer identity. */
  auth: { kind: 'appProxyHmac' | 'customerAccountJwt' }
  query: Record<string, string>
  params: Record<string, string>
  headers: Record<string, string>
  path: string
  method: string
  body: unknown
}

export type ProxyHandler = (ctx: ProxyContext) => Promise<unknown> | unknown

export interface ProxyDefinition {
  type?: ProxyResponseType
  GET?: ProxyHandler
  POST?: ProxyHandler
  PUT?: ProxyHandler
  DELETE?: ProxyHandler
  PATCH?: ProxyHandler
}

// ─── Retry & Worker ─────────────────────────────────────────────────

export interface RetryPolicy {
  maxAttempts: number
  initialIntervalMs: number
  backoffCoefficient: number
  maxIntervalMs: number
}

export interface WorkerConfig {
  concurrency: number
  pollIntervalMs: number
  pollMaxIntervalMs: number
  pollBackoffCoefficient: number
  leaseDurationMs: number
}

export interface DispatchOptions {
  delayMs?: number
  retryPolicy?: Partial<RetryPolicy>
}

// ─── DB row types ────────────────────────────────────────────────────

export type FlowRunStatus = 'pending' | 'running' | 'sleeping' | 'completed' | 'failed' | 'canceled'
export type StepStatus = 'pending' | 'running' | 'sleeping' | 'completed' | 'failed' | 'canceled'
export type LogLevel = 'info' | 'warn' | 'error'

// ─── JWT ─────────────────────────────────────────────────────────────

export interface JwtPayload {
  iss: string
  dest: string
  aud: string
  sub: string
  exp: number
  nbf: number
  iat: number
  jti: string
  sid: string
}
