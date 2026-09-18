import type { ComponentType } from 'preact'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { Type } from 'arktype'
import type { RuntimeConnectors } from '../server/connectors.ts'
import type { ShopifyClient } from '../shopify/client.ts'
import type { getDb } from '../db/client.ts'
import { buildAdminFunctionRpcUrl } from './rpc.ts'

declare global {
  interface Window {
    shopify?: {
      idToken(): Promise<string>
      toast?: {
        show(message: string, options?: {
          action?: string
          duration?: number
          isError?: boolean
          onAction?: () => void
          onDismiss?: () => void
        }): string
      }
    }
  }
}

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export interface AdminActor {
  id: string
  sessionId: string
}

export interface AdminServerContext<TParams extends Record<string, string> = Record<string, string>> {
  shop: string
  shopifyApp: string
  actor: AdminActor
  params: Readonly<TParams>
  db: ReturnType<typeof getDb>
  shopify: ShopifyClient
  connectors: RuntimeConnectors
  requestId: string
  idempotencyKey?: string
}

export type AdminAuthorize<TParams extends Record<string, string> = Record<string, string>> = (
  context: AdminServerContext<TParams>,
) => boolean | Promise<boolean>

export function defineAdminPageAccess<
  TParams extends Record<string, string> = Record<string, string>,
>(authorize: AdminAuthorize<TParams>): AdminAuthorize<TParams> {
  return authorize
}

interface AdminFunctionBase<
  TInput,
  TOutput extends JsonValue,
  TParams extends Record<string, string>,
> {
  output?: Type<TOutput>
  authorize?: AdminAuthorize<TParams>
  handler: (
    context: AdminServerContext<TParams>,
    input: TInput,
  ) => TOutput | Promise<TOutput>
}

export interface AdminLoaderDefinition<
  TInput = undefined,
  TOutput extends JsonValue = JsonValue,
  TParams extends Record<string, string> = Record<string, string>,
> extends AdminFunctionBase<TInput, TOutput, TParams> {
  kind: 'loader'
  input?: Type<TInput>
}

export interface AdminActionDefinition<
  TInput,
  TOutput extends JsonValue = JsonValue,
  TParams extends Record<string, string> = Record<string, string>,
> extends AdminFunctionBase<TInput, TOutput, TParams> {
  kind: 'action'
  input: Type<TInput>
}

export type AnyAdminFunctionDefinition =
  | AdminLoaderDefinition<unknown, JsonValue>
  | AdminActionDefinition<unknown, JsonValue>

export interface AdminPageDefinition<TProps = Record<string, string>> {
  title?: string
  component: ComponentType<TProps>
}

export function defineAdminPage<TProps>(
  definition: AdminPageDefinition<TProps>,
): AdminPageDefinition<TProps> {
  return definition
}

export function defineAdminLoader<
  TInput = undefined,
  TOutput extends JsonValue = JsonValue,
  TParams extends Record<string, string> = Record<string, string>,
>(
  definition: Omit<AdminLoaderDefinition<TInput, TOutput, TParams>, 'kind'>,
): AdminLoaderDefinition<TInput, TOutput, TParams> {
  return { ...definition, kind: 'loader' }
}

export function defineAdminAction<
  TInput,
  TOutput extends JsonValue = JsonValue,
  TParams extends Record<string, string> = Record<string, string>,
>(
  definition: Omit<AdminActionDefinition<TInput, TOutput, TParams>, 'kind'>,
): AdminActionDefinition<TInput, TOutput, TParams> {
  return { ...definition, kind: 'action' }
}

export class AdminPublicError extends Error {
  readonly code: string
  readonly status: number
  readonly fieldErrors?: Record<string, string>

  constructor(
    code: string,
    message: string,
    options?: { status?: number; fieldErrors?: Record<string, string> },
  ) {
    super(message)
    this.name = 'AdminPublicError'
    this.code = code
    this.status = options?.status ?? 400
    this.fieldErrors = options?.fieldErrors
  }
}

export interface AdminFunctionReference<TInput, TOutput extends JsonValue> {
  readonly kind: 'loader' | 'action'
  readonly name: string
  readonly pagePattern: string
  readonly __input?: TInput
  readonly __output?: TOutput
}

export type AdminLoaderClient<
  TInput,
  TOutput extends JsonValue,
> = AdminFunctionReference<TInput, TOutput> | AdminLoaderDefinition<TInput, TOutput>

export type AdminActionClient<
  TInput,
  TOutput extends JsonValue,
> = AdminFunctionReference<TInput, TOutput> | AdminActionDefinition<TInput, TOutput>

export function createAdminFunctionReference<TInput, TOutput extends JsonValue>(
  reference: Omit<AdminFunctionReference<TInput, TOutput>, '__input' | '__output'>,
): AdminFunctionReference<TInput, TOutput> {
  return reference
}

interface RpcError {
  error: string
  code?: string
  requestId?: string
  fieldErrors?: Record<string, string>
}

export class AdminRpcError extends Error {
  readonly code?: string
  readonly requestId?: string
  readonly fieldErrors?: Record<string, string>

  constructor(payload: RpcError) {
    super(payload.error)
    this.name = 'AdminRpcError'
    this.code = payload.code
    this.requestId = payload.requestId
    this.fieldErrors = payload.fieldErrors
  }
}

async function callAdminFunction<TInput, TOutput extends JsonValue>(
  reference: AdminLoaderClient<TInput, TOutput> | AdminActionClient<TInput, TOutput>,
  input: TInput,
  options?: { signal?: AbortSignal; idempotencyKey?: string; pathname?: string },
): Promise<TOutput> {
  const clientReference = reference as AdminFunctionReference<TInput, TOutput>
  const headers = new Headers({ 'content-type': 'application/json' })
  const token = await window.shopify?.idToken?.()
  if (token) headers.set('authorization', `Bearer ${token}`)
  if (options?.idempotencyKey) headers.set('idempotency-key', options.idempotencyKey)

  const response = await fetch(
    buildAdminFunctionRpcUrl(
      clientReference.kind,
      clientReference.name,
      options?.pathname ?? window.location.pathname,
    ),
    {
      method: 'POST',
      headers,
      signal: options?.signal,
      body: JSON.stringify({ input: input ?? null }),
    },
  )
  const payload = await response.json() as TOutput | RpcError
  if (!response.ok) throw new AdminRpcError(payload as RpcError)
  return payload as TOutput
}

export interface AdminLoaderHandle {
  readonly kind: 'loader'
}

type AnyLoaderClient = AdminLoaderHandle
const loaderListeners = new Map<AnyLoaderClient, Set<() => void>>()

function revalidate(reference: AnyLoaderClient) {
  for (const listener of loaderListeners.get(reference) ?? []) listener()
}

export interface AdminLoaderState<TOutput> {
  data?: TOutput
  error?: Error
  loading: boolean
  revalidate(): void
}

export function useLoader<TInput, TOutput extends JsonValue>(
  reference: AdminLoaderClient<TInput, TOutput>,
  input: TInput,
): AdminLoaderState<TOutput> {
  const [state, setState] = useState<Omit<AdminLoaderState<TOutput>, 'revalidate'>>({ loading: true })
  const [generation, setGeneration] = useState(0)
  const serializedInput = JSON.stringify(input ?? null)
  const pathname = window.location.pathname
  const refresh = useCallback(() => setGeneration((value) => value + 1), [])

  useEffect(() => {
    const listeners = loaderListeners.get(reference as AnyLoaderClient) ?? new Set()
    listeners.add(refresh)
    loaderListeners.set(reference as AnyLoaderClient, listeners)
    return () => {
      listeners.delete(refresh)
      if (listeners.size === 0) loaderListeners.delete(reference as AnyLoaderClient)
    }
  }, [reference, refresh])

  useEffect(() => {
    const controller = new AbortController()
    setState((current) => ({ ...current, loading: true, error: undefined }))
    void callAdminFunction(reference, JSON.parse(serializedInput) as TInput, {
      signal: controller.signal,
      pathname,
    })
      .then((data) => setState({ data, loading: false }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ error: error instanceof Error ? error : new Error(String(error)), loading: false })
        }
      })
    return () => controller.abort()
  }, [reference, serializedInput, pathname, generation])

  return { ...state, revalidate: refresh }
}

export interface AdminActionOptions {
  concurrency?: 'ignore' | 'allow'
  idempotencyKey?: string
  revalidate?: AnyLoaderClient[]
}

export interface AdminActionState<TInput, TOutput> {
  data?: TOutput
  error?: Error
  pending: boolean
  invoke(input: TInput, options?: AdminActionOptions): Promise<TOutput | undefined>
  reset(): void
}

export function useAction<TInput, TOutput extends JsonValue>(
  reference: AdminActionClient<TInput, TOutput>,
): AdminActionState<TInput, TOutput> {
  const [state, setState] = useState<Omit<AdminActionState<TInput, TOutput>, 'invoke' | 'reset'>>({ pending: false })
  const inFlight = useRef(0)
  const latestInvocation = useRef(0)

  const invoke = useCallback(async (input: TInput, options?: AdminActionOptions) => {
    if (inFlight.current > 0 && options?.concurrency !== 'allow') return undefined
    inFlight.current += 1
    const invocation = ++latestInvocation.current
    setState((current) => ({ ...current, pending: true, error: undefined }))
    try {
      const data = await callAdminFunction(reference, input, options)
      inFlight.current -= 1
      setState((current) => invocation === latestInvocation.current
        ? { data, pending: inFlight.current > 0 }
        : { ...current, pending: inFlight.current > 0 })
      for (const loader of options?.revalidate ?? []) revalidate(loader)
      return data
    } catch (error) {
      inFlight.current -= 1
      setState((current) => invocation === latestInvocation.current
        ? {
            error: error instanceof Error ? error : new Error(String(error)),
            pending: inFlight.current > 0,
          }
        : { ...current, pending: inFlight.current > 0 })
      throw error
    }
  }, [reference])

  const reset = useCallback(() => setState({ pending: inFlight.current > 0 }), [])
  return { ...state, invoke, reset }
}
