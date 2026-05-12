import { defineConfig } from 'openshop'
import { syncOrders } from './flows/syncOrders.ts'
import { warehouse } from './providers/warehouse.ts'

export default defineConfig({
  providers: { warehouse },
  flows: { syncOrders },
  crons: [
    { name: 'Quick sync', schedule: '*/5 * * * *', flow: 'syncOrders', input: { limit: 10 } },
  ],
  onError: async (error, context) => {
    console.error(`[openshop:error] Flow "${context?.flow}" failed:`, error.message)
  },
})
