import { defineConfig } from 'openshop'
import { syncOrders } from './flows/syncOrders'
import { countVariants } from './flows/countVariants'
import { warehouse } from './providers/warehouse'
import { volumeDiscount } from './functions/volumeDiscount'
import { ordersCreate } from './webhooks/ordersCreate'
import { appUninstalled } from './webhooks/appUninstalled'

export default defineConfig({
  providers: { warehouse },
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
