import { strictShopDomain } from '../server/shop-domain.ts'
import { DEFAULT_SHOPIFY_APP_HANDLE } from '../server/shopify-apps.ts'
import { openAdminTokenSource, sendWithAdminToken } from './client-credentials.ts'

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
  shopifyApp: string
}

/**
 * Creates a Shopify Admin API client for a specific shop.
 * Reads the access token from the installations table.
 *
 * A stored token is used as is. After a 401 from the Admin API, the token is
 * replaced once by Shopify's client credentials grant and the call retried once;
 * when that fails, the 401 error is thrown. When `SHOPIFY_CLIENT_CREDENTIALS_SHOP`
 * names this shop (or the shop is the `__global__` placeholder) and the app is
 * `default`, a missing token is obtained by that grant and the client talks to
 * the configured shop.
 */
export async function createShopifyClient(
  shop: string,
  shopifyAppOrApiVersion = DEFAULT_SHOPIFY_APP_HANDLE,
  apiVersion = SHOPIFY_API_VERSION,
): Promise<ShopifyClient> {
  return openShopifyClient(shop, shopifyAppOrApiVersion, apiVersion)
}

/**
 * `createShopifyClient` for the flow runner: `signal` (the run's) stops waiting
 * for a client credentials grant when the run is cancelled.
 */
export async function openShopifyClient(
  shop: string,
  shopifyAppOrApiVersion = DEFAULT_SHOPIFY_APP_HANDLE,
  apiVersion = SHOPIFY_API_VERSION,
  options?: { signal?: AbortSignal },
): Promise<ShopifyClient> {
  const isApiVersion = /^\d{4}-\d{2}$/.test(shopifyAppOrApiVersion)
  const shopifyApp = isApiVersion ? DEFAULT_SHOPIFY_APP_HANDLE : shopifyAppOrApiVersion
  const resolvedApiVersion = isApiVersion ? shopifyAppOrApiVersion : apiVersion
  const tokens = await openAdminTokenSource(shopifyApp, shop, options?.signal ? { signal: options.signal } : undefined)

  const graphql = async (query: string, options?: { variables?: Record<string, unknown> }) => {
    // The token comes first, so a shop without one keeps today's error.
    await tokens.token()
    const shopDomain = strictShopDomain(tokens.shop.includes('.') ? tokens.shop : `${tokens.shop}.myshopify.com`)
    if (!shopDomain) throw new Error(`[openshop] Invalid shop domain "${tokens.shop}": expected <name>.myshopify.com`)

    const response = await sendWithAdminToken(
      tokens,
      (accessToken) => postGraphql(shopDomain, resolvedApiVersion, accessToken, query, options),
    )
    return readGraphqlResponse(response)
  }

  return { graphql, shop: tokens.shop, shopifyApp } as ShopifyClient
}

function postGraphql(
  shopDomain: string,
  apiVersion: string,
  accessToken: string,
  query: string,
  options?: { variables?: Record<string, unknown> },
): Promise<Response> {
  return fetch(
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
      // A redirect would carry the access token to another address.
      redirect: 'error',
    },
  )
}

async function readGraphqlResponse(response: Response): Promise<unknown> {
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
