import { sql } from 'drizzle-orm'
import { closeDb, getDb } from '#db/client'
import type { OpenShopConfig, FlowDefinition, WebhookDefinition, FunctionDefinition, McpConfig, ShopifyConfig } from '#types'

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
  }
}
