---
title: Define a flow
description: Add a validated, checkpointed background job with retries and cancellation.
---

Flows run in workers. Use them for integration work that should be retried,
logged, scheduled, or resumed after a delay.

## 1. Create the flow

Create `flows/syncOrders.ts`:

```ts
import { type } from 'arktype'
import { app } from '#app'

export const syncOrders = app.defineFlow({
  name: 'syncOrders',
  input: type({ limit: 'number.integer > 0' }),
  timeout: 60_000,
  stepTimeout: 15_000,
  concurrency: 'reject',

  async run({ input, shop, shopify, connectors, step, logger, signal }) {
    const orders = await step('fetch-orders', async () => {
      logger.info({ shop, limit: input.limit }, 'Fetching orders')

      return shopify.graphql(`#graphql
        query GetOrders($first: Int!) {
          orders(first: $first) {
            nodes {
              id
              name
            }
          }
        }
      `, { variables: { first: input.limit } })
    })

    await step('push-orders', async () => {
      if (signal.aborted) return
      await connectors.warehouse.push(orders.orders.nodes)
    })
  },
})
```

`shopify.graphql()` already returns the GraphQL `data` object. The correct path
is `orders.orders.nodes`, not `orders.data.orders.nodes`.

## 2. Register the flow

```ts
// openshop.config.ts
import { app } from '#app'
import { syncOrders } from '#flows/syncOrders'

export default app.defineConfig({
  flows: { syncOrders },
})
```

The template defines package-private aliases such as `#app`, `#flows/*`, and
`#providers/*` in `package.json`.

## 3. Choose retry and concurrency behavior

The default retry policy makes three total attempts with delays of 1 and 2
seconds. Override only what this flow needs:

```ts
retryPolicy: {
  maxAttempts: 5,
  initialIntervalMs: 2_000,
  backoffCoefficient: 2,
  maxIntervalMs: 60_000,
},
```

`concurrency: 'reject'` prevents another active run for the same app, shop, and
flow. Dispatch throws `FlowConcurrencyError` and includes the active run ID.
Choose `'allow'` only when overlapping side effects are safe.

## 4. Add an optional schedule

```ts
import { cron } from 'openshop'

export default app.defineConfig({
  flows: { syncOrders },
  crons: [
    {
      name: 'Sync orders',
      schedule: cron('*/5 * * * *'),
      flow: 'syncOrders',
      input: { limit: 100 },
      shops: 'all',
    },
  ],
})
```

An unknown flow name fails config validation. `shops` defaults to `global`,
which dispatches once with the synthetic shop `__global__` and default app
handle. Shopify/provider flows should usually target `all`, one installed shop
domain, or an installed-shop array.

## 5. Verify

```bash
pnpm run codegen
pnpm run lint
pnpm exec openshop worker
```

Trigger the flow from the embedded admin UI and confirm both steps appear.
Completed step output is cached, so a retry skips `fetch-orders` and reuses its
stored JSON result.

For delayed continuation, use `await step.sleep(name, milliseconds)`. It releases
the worker slot. For cancellation, pass `signal` to `fetch` and other abortable
APIs; OpenShop cannot forcibly stop code that ignores it.
