---
title: Define a flow
description: Add a checkpointed background job that calls Shopify and provider connectors.
---

Flows are background jobs executed by OpenShop workers. Use them for integration work that should be retried, logged, scheduled, or triggered outside a single HTTP request.

## Create the flow file

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
      await connectors.warehouse.push(orders.data.orders.nodes)
    })
  },
})
```

## Register the flow

```ts
// openshop.config.ts
import { app } from '#app'
import { syncOrders } from '#flows/syncOrders'

export default app.defineConfig({
  flows: { syncOrders },
})
```

The generated template defines package-private import aliases in `package.json`, so flow files do not need `../` imports:

```json
{
  "imports": {
    "#app": "./openshop.app.ts",
    "#flows/*": "./flows/*.ts",
    "#providers/*": "./providers/*.ts"
  }
}
```

## Add a schedule

```ts
import { cron } from 'openshop'

export default app.defineConfig({
  flows: { syncOrders },
  crons: [
    { name: 'Sync orders', schedule: cron('*/5 * * * *'), flow: 'syncOrders', shops: 'all' },
  ],
})
```

## Verify it worked

Run:

```bash
pnpm run codegen
pnpm run lint
```

Open the embedded admin UI. The flow should appear in the flows page. When it runs, each `step()` should produce a checkpointed step result and logs should include the messages emitted through `logger`.

## Failure modes

- Completed step outputs must be JSON serializable because OpenShop stores them for retry.
- Flow and step timeouts mark the run as failed, but JavaScript cannot cancel arbitrary user code. Pass `ctx.signal` to abortable APIs such as `fetch`.
- If a cron entry references an unknown flow, `app.defineConfig()` fails validation early.
