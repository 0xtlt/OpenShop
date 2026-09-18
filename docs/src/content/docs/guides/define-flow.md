---
title: Sync orders with a flow
description: Read Shopify orders, send them to a provider, and schedule the job for installed shops.
---

Use this guide to send recent orders to a warehouse in a background job.
Before starting, have an installed development app with `read_orders` access and
a registered, configured `warehouse` provider exposing `push(rows)`. Follow
[Connect an external service](/guides/define-provider/) if you need that provider.

## 1. Create the flow

Create or replace `flows/syncOrders.ts`:

```ts
import { type } from 'arktype'
import { app } from '#app'

export const syncOrders = app.defineFlow({
  name: 'syncOrders',
  input: type({ limit: 'number.integer > 0' }),
  timeout: 60_000,
  stepTimeout: 15_000,

  async run({ input, shopify, connectors, step, logger, signal }) {
    const orders = await step('fetch-orders', async () => {
      const data = await shopify.graphql(`#graphql
        query SyncOrders($first: Int!) {
          orders(first: $first, sortKey: CREATED_AT, reverse: true) {
            nodes { id name }
          }
        }
      `, { variables: { first: input.limit } })

      return data.orders.nodes
    })

    await step('push-orders', async () => {
      signal.throwIfAborted()
      await connectors.warehouse.push(orders)
      logger.info({ count: orders.length }, 'Orders synced')
    })
  },
})
```

`shopify.graphql()` returns the GraphQL data object, so the order list is
`data.orders.nodes`. The saved checkpoint contains only that JSON array.

This fetches one recent batch. For a complete historical sync, add pagination and
a durable cursor appropriate to your integration.

## 2. Register and run it

Add the flow to the existing `flows` registry in `openshop.config.ts`:

```ts
import { app } from '#app'
import { syncOrders } from '#flows/syncOrders'

export default app.defineConfig({
  flows: { syncOrders },
})
```

Preserve any other registered flows and app options. Generate the query types and
check the app:

```bash
pnpm run lint
```

With `pnpm run shopify` running, save the warehouse configuration in **Providers**,
then trigger `syncOrders` in **Flows** with `{ "limit": 10 }`. Confirm that both
steps complete and **Orders synced** appears in the logs. Development already
starts a worker. Production needs a [separate worker service](/guides/deploy-production/).

## 3. Schedule the flow for installed shops

Add `crons` to the same config:

```ts
export default app.defineConfig({
  flows: { syncOrders },
  crons: [{
    name: 'Sync recent orders',
    schedule: '*/5 * * * *',
    flow: 'syncOrders',
    input: { limit: 10 },
    shops: 'all',
  }],
})
```

`shops: 'all'` dispatches for each installed app/shop pair. Omitting `shops` uses
the synthetic `__global__` shop, which has no ordinary Shopify installation.
For a shop-specific integration, set the target explicitly. Configure credentials
for every targeted shop before enabling the schedule.

Verify a new run appears after the next five-minute boundary. The default
concurrency policy rejects a second active run for the same app, shop, and flow.

## 4. Make repeated writes safe

Each scheduled run can include orders sent by an earlier run. Make the warehouse
write an upsert keyed by the Shopify order ID, or use the warehouse's idempotency
mechanism. Completed checkpoints are reused within one run; separate scheduled
runs do not share them.

If you need a different retry policy, set `retryPolicy` on this flow and consult
the [flow reference](/reference/flows/#retry-precedence-and-defaults). For the
failure model, read [Checkpoints and retries](/concepts/checkpoints-and-retries/).
