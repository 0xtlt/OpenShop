import { defineWebhook } from 'openshop'

export const ordersCreate = defineWebhook({
  async run({ shop, payload }) {
    const order = payload as { name: string; total_price: string }
    console.log(`[webhook] New order on ${shop}: ${order.name} — ${order.total_price}`)
  },
})
