import type { OpenShopConfig } from '#types'

// ─── Fake method (spy) ──────────────────────────────────────────────

export interface FakeCall<TArgs extends unknown[] = unknown[]> {
  args: TArgs
  returnedValue: unknown
  thrownError: Error | undefined
  timestamp: number
}

export interface FakeMethod<TArgs extends unknown[] = unknown[], TReturn = unknown> {
  (...args: TArgs): Promise<TReturn>
  calls: FakeCall<TArgs>[]
  called: boolean
  callCount: number
  lastCall: FakeCall<TArgs> | undefined
  returns(value: TReturn): void
  rejects(error: Error): void
  onCall(n: number): { returns(value: TReturn): void; rejects(error: Error): void }
  impl(fn: (...args: TArgs) => TReturn | Promise<TReturn>): void
  reset(): void
}

function createFakeMethod<TArgs extends unknown[] = unknown[], TReturn = unknown>(): FakeMethod<TArgs, TReturn> {
  let defaultReturn: unknown
  let defaultError: Error | null = null
  let customImpl: Function | null = null
  const perCall = new Map<number, { type: 'return' | 'reject'; value: unknown }>()
  const calls: FakeCall<TArgs>[] = []

  const fn = (async (...args: unknown[]) => {
    const idx = calls.length
    const override = perCall.get(idx)

    let returnedValue: unknown
    let thrownError: Error | undefined

    try {
      if (override?.type === 'reject') throw override.value
      if (override?.type === 'return') returnedValue = override.value
      else if (customImpl) returnedValue = await customImpl(...args)
      else if (defaultError) throw defaultError
      else returnedValue = defaultReturn
    } catch (e) {
      thrownError = e instanceof Error ? e : new Error(String(e))
      calls.push({ args: args as TArgs, returnedValue: undefined, thrownError, timestamp: Date.now() })
      throw thrownError
    }

    calls.push({ args: args as TArgs, returnedValue, thrownError: undefined, timestamp: Date.now() })
    return returnedValue
  }) as unknown as FakeMethod<TArgs, TReturn>

  Object.defineProperty(fn, 'calls', { get: () => calls })
  Object.defineProperty(fn, 'called', { get: () => calls.length > 0 })
  Object.defineProperty(fn, 'callCount', { get: () => calls.length })
  Object.defineProperty(fn, 'lastCall', { get: () => calls.at(-1) })

  fn.returns = (v) => { defaultReturn = v }
  fn.rejects = (e) => { defaultError = e }
  fn.impl = (f) => { customImpl = f }
  fn.reset = () => { calls.length = 0; defaultReturn = undefined; defaultError = null; customImpl = null; perCall.clear() }
  fn.onCall = (n) => ({
    returns: (v: TReturn) => perCall.set(n, { type: 'return', value: v }),
    rejects: (e: Error) => perCall.set(n, { type: 'reject', value: e }),
  })

  return fn
}

// ─── Typed fake providers ───────────────────────────────────────────

/** Wraps each method of a connector into a FakeMethod with matching args/return types */
type FakeOf<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R>
    ? FakeMethod<A, R>
    : T[K] extends (...args: infer A) => infer R
      ? FakeMethod<A, R>
      : never
}

/** Typed fakes for all connectors — mirrors OpenShopConnectors but with FakeMethod wrappers */
export type TypedFakeProviders = {
  [K in keyof OpenShopConnectors]: FakeOf<OpenShopConnectors[K]>
}

export function createFakeProviders(providers: OpenShopConfig['providers']): TypedFakeProviders {
  const fakes: Record<string, Record<string, FakeMethod>> = {}

  for (const [name, provider] of Object.entries(providers)) {
    const fake: Record<string, FakeMethod> = {}
    for (const methodName of Object.keys(provider.methods)) {
      fake[methodName] = createFakeMethod()
    }
    fakes[name] = fake
  }

  return fakes as unknown as TypedFakeProviders
}

export function resetFakeProviders(fakes: TypedFakeProviders) {
  for (const name of Object.keys(fakes)) {
    const provider = (fakes as Record<string, Record<string, FakeMethod>>)[name]
    for (const methodName of Object.keys(provider)) {
      provider[methodName].reset()
    }
  }
}
