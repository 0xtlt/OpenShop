import { eq } from 'drizzle-orm'
import { getDb } from '../db/client.js'
import { installations } from '../db/schema.js'

const SHOPIFY_API_VERSION = '2026-04'

export interface GraphQLResponse<T = unknown> {
  data?: T
  errors?: Array<{ message: string; locations?: Array<{ line: number; column: number }> }>
  extensions?: Record<string, unknown>
}

type OpenShopOperations = OpenShopQueries & OpenShopMutations

export interface ShopifyClient {
  graphql<Query extends string>(
    query: Query,
    ...args: Query extends keyof OpenShopOperations
      ? OpenShopOperations[Query] extends { variables: infer V }
        ? keyof V extends never
          ? [options?: { variables?: Record<string, unknown> }]
          : [options: { variables: V }]
        : [options?: { variables?: Record<string, unknown> }]
      : [options?: { variables?: Record<string, unknown> }]
  ): Promise<
    Query extends keyof OpenShopOperations
      ? OpenShopOperations[Query] extends { return: infer R } ? R : unknown
      : unknown
  >
  shop: string
}

/**
 * Creates a Shopify Admin API client for a specific shop.
 * Reads the access token from the installations table.
 */
export async function createShopifyClient(shop: string, apiVersion = SHOPIFY_API_VERSION): Promise<ShopifyClient> {
  const db = getDb()
  const [installation] = await db.select().from(installations).where(eq(installations.shop, shop)).limit(1)

  const accessToken = installation?.accessToken

  const graphql = async (query: string, options?: { variables?: Record<string, unknown> }) => {
    if (!accessToken) {
      throw new Error(`[openshop] No access token found for shop "${shop}". Is the app installed?`)
    }

    const shopDomain = shop.includes('.') ? shop : `${shop}.myshopify.com`

    const response = await fetch(
      `https://${shopDomain}/admin/api/${apiVersion}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({
          query,
          variables: options?.variables,
        }),
      },
    )

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`[openshop] Shopify GraphQL error (${response.status}): ${text}`)
    }

    const json: GraphQLResponse = await response.json()

    if (json.errors?.length) {
      const messages = json.errors.map((e) => e.message).join('; ')
      throw new Error(`[openshop] GraphQL errors: ${messages}`)
    }

    return json.data
  }

  return { graphql, shop } as ShopifyClient
}
