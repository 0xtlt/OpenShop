import { type } from 'arktype'
import { defineOpenShop } from '../../src/index.ts'
import * as publicApi from '../../src/index.ts'

const app = defineOpenShop({ providers: {} })
const syncOrders = app.defineFlow({
  name: 'syncOrders',
  input: type({ limit: 'number.integer > 0' }),
  async run() {},
})
const openshop = app.defineConfig({ flows: { syncOrders } })

void openshop.dispatchFlow({
  flowName: 'syncOrders',
  input: { limit: 50 },
  shop: 'example.myshopify.com',
})

// @ts-expect-error flow dispatch is only exposed on a configured OpenShop instance
void publicApi.dispatchFlow

void openshop.dispatchFlow({
  flowName: 'syncOrders',
  // @ts-expect-error limit is inferred from the selected flow input
  input: { limit: '50' },
  shop: 'example.myshopify.com',
})

void openshop.dispatchFlow({
  // @ts-expect-error only registered flow keys are accepted
  flowName: 'missingFlow',
  shop: 'example.myshopify.com',
})
