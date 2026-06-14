import type { ShopifyClient } from '../shopify/client.ts'

// ─── Factory definition ─────────────────────────────────────────────

export interface Factory<TResource, TOverrides = Record<string, unknown>> {
  create: (shopify: ShopifyClient, overrides?: Partial<TOverrides>) => Promise<TResource>
  destroy: (shopify: ShopifyClient, resource: TResource) => Promise<void>
}

/**
 * Define a test factory. Identity function for type inference.
 *
 * @example
 * export const customerFactory = defineFactory({
 *   async create(shopify, overrides = {}) {
 *     const data = await shopify.graphql(`mutation ...`, { variables: { input: { ... } } })
 *     return data.customerCreate.customer
 *   },
 *   async destroy(shopify, customer) {
 *     await shopify.graphql(`mutation ...`, { variables: { id: customer.id } })
 *   },
 * })
 */
export function defineFactory<TResource, TOverrides = Record<string, unknown>>(
  factory: Factory<TResource, TOverrides>,
): Factory<TResource, TOverrides> {
  return factory
}

// ─── Scope: tracks created resources for auto-cleanup ───────────────

interface TrackedEntry {
  factory: Factory<unknown>
  resource: unknown
}

export class FactoryScope {
  #entries: TrackedEntry[] = []
  #shopify: ShopifyClient

  constructor(shopify: ShopifyClient) {
    this.#shopify = shopify
  }

  /**
   * Create a resource using a factory. Tracked for auto-cleanup.
   */
  async create<TResource, TOverrides>(
    factory: Factory<TResource, TOverrides>,
    overrides?: Partial<TOverrides>,
  ): Promise<TResource> {
    const resource = await factory.create(this.#shopify, overrides)
    this.#entries.push({ factory: factory as Factory<unknown>, resource })
    return resource
  }

  /**
   * Cleanup all created resources in reverse order (LIFO).
   * Errors are logged but don't block cleanup of remaining resources.
   */
  async cleanup() {
    const entries = [...this.#entries].reverse()
    this.#entries = []

    for (const { factory, resource } of entries) {
      try {
        await factory.destroy(this.#shopify, resource)
      } catch (err) {
        console.warn(`[openshop:test] cleanup failed:`, err instanceof Error ? err.message : err)
      }
    }
  }

  /** Number of tracked resources */
  get size() {
    return this.#entries.length
  }
}
