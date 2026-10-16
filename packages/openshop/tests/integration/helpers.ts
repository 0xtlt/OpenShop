import { sql } from 'drizzle-orm'
import { closeDb, getDb } from '#db/client'
import { resetClientCredentialsState } from '../../src/shopify/client-credentials.ts'
import type { OpenShopConfig, FlowDefinition, WebhookDefinition, FunctionDefinition, McpConfig, ShopifyConfig, AdminPagesConfig } from '#types'

export const TEST_SHOP = 'test-integration.myshopify.com'

export async function truncateAll() {
  const db = getDb()
  await db.execute(sql`TRUNCATE mcp_audit_logs, mcp_permission_grants, mcp_tokens, flow_runs, step_results, logs, provider_configs, cron_overrides, installations CASCADE`)
}

export async function shutdownDb() {
  await closeDb()
}

export function createConfig(
  flows: Record<string, FlowDefinition<any>>,
  options?: {
    shopify?: ShopifyConfig
    webhooks?: Record<string, WebhookDefinition>
    functions?: Record<string, FunctionDefinition<any>>
    mcp?: McpConfig
    pages?: AdminPagesConfig
  },
): OpenShopConfig {
  return {
    ...(options?.shopify ? { shopify: options.shopify } : {}),
    providers: {},
    flows,
    crons: [],
    ...(options?.webhooks ? { webhooks: options.webhooks } : {}),
    ...(options?.functions ? { functions: options.functions } : {}),
    ...(options?.mcp ? { mcp: options.mcp } : {}),
    ...(options?.pages ? { pages: options.pages } : {}),
  }
}

export const CLIENT_CREDENTIALS_GRANT = 'client_credentials'
export const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange'

export interface ShopifyTokenRequest {
  shop: string
  grantType: string
}

export interface ShopifyTokenEndpoints {
  /** Requests to `https://<shop>/admin/oauth/access_token`, in order. */
  calls: ShopifyTokenRequest[]
  restore: () => void
}

/**
 * Answers Shopify's token endpoint offline, the way Shopify answers an app
 * that is not installed on a store of its organization: token exchange and the
 * client credentials grant are both refused, so a session token for a shop
 * without a stored token leaves it without one, as before these requests were
 * mocked. Every request is recorded; any other non-local request is refused by
 * the bootstrap's network guard. Also clears the in-memory grant state, so
 * each test starts with no remembered refusal.
 */
export function refuseShopifyTokenRequests(): ShopifyTokenEndpoints {
  resetClientCredentialsState()
  const previousFetch = globalThis.fetch
  const endpoints: ShopifyTokenEndpoints = {
    calls: [],
    restore: () => { globalThis.fetch = previousFetch },
  }
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const match = url.match(/^https:\/\/([a-z0-9][a-z0-9-]*\.myshopify\.com)\/admin\/oauth\/access_token$/)
    if (!match || init?.method !== 'POST') return previousFetch(input, init)

    const body = String(init.body ?? '')
    const grantType = body.startsWith('{')
      ? String((JSON.parse(body) as { grant_type?: unknown }).grant_type)
      : String(new URLSearchParams(body).get('grant_type'))
    endpoints.calls.push({ shop: match[1]!, grantType })
    const error = grantType === CLIENT_CREDENTIALS_GRANT ? 'shop_not_permitted' : 'invalid_subject_token'
    return Response.json({ error }, { status: 400 })
  }
  return endpoints
}
