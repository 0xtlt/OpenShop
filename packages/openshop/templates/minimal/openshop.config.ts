import { app } from './openshop.app.ts'
import { syncOrders } from './flows/syncOrders.ts'

export default app.defineConfig({
  flows: { syncOrders },
  crons: [
    { name: 'Quick sync', schedule: '*/5 * * * *', flow: 'syncOrders', input: { limit: 10 } },
  ],
  onError: async (error, context) => {
    console.error(`[openshop:error] Flow "${context?.flow}" failed:`, error.message)
  },
})
