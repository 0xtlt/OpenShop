import { app } from './openshop.app.ts'
import { syncOrders } from './flows/syncOrders.ts'
import { countVariants } from './flows/countVariants.ts'
import { volumeDiscount } from './functions/volumeDiscount.ts'
import { ordersCreate } from './webhooks/ordersCreate.ts'
import { appUninstalled } from './webhooks/appUninstalled.ts'

export default app.defineConfig({
  flows: { syncOrders, countVariants },
  functions: { volumeDiscount },

  webhooks: {
    'orders/create': ordersCreate,
    'app/uninstalled': appUninstalled,
  },

  crons: [
    { name: 'Quick sync', schedule: '*/5 * * * *', flow: 'syncOrders', input: { limit: 10 } },
    { name: 'Nightly full sync', schedule: '0 2 * * *', flow: 'syncOrders', input: { limit: 1000 }, shops: 'all' },
  ],

  onError: async (error, context) => {
    console.error(`[openshop:error] Flow "${context?.flow}" failed:`, error.message)
  },
})
