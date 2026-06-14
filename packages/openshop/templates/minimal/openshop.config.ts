import { defineConfig } from 'openshop'
import { syncOrders } from './flows/syncOrders.ts'
import { warehouse } from './providers/warehouse.ts'

export default defineConfig({
  // Single-app projects can keep Shopify credentials in env/TOML.
  // Add `shopify.apps` only when one OpenShop instance must serve several Shopify apps.
  providers: { warehouse },
  flows: { syncOrders },
  crons: [
    { name: 'Quick sync', schedule: '*/5 * * * *', flow: 'syncOrders', input: { limit: 10 } },
  ],
  onError: async (error, context) => {
    console.error(`[openshop:error] Flow "${context?.flow}" failed:`, error.message)
  },
})
