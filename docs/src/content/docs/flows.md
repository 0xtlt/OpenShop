---
title: Flows
description: Define background jobs with checkpointed steps.
---

Flows are background jobs executed by OpenShop workers.

```ts
import { defineFlow } from 'openshop'
import { type } from 'arktype'

export const syncOrders = defineFlow({
  name: 'syncOrders',
  input: type({ limit: 'number.integer > 0' }),
  timeout: 60_000,
  stepTimeout: 15_000,
  concurrency: 'reject',

  async run({ input, shop, shopify, connectors, step, logger, db, signal }) {
    const orders = await step('fetch-orders', async () => {
      logger.info({ shop, limit: input.limit }, 'Fetching orders')
      return shopify.graphql(`#graphql
        query GetOrders($first: Int!) {
          orders(first: $first) { nodes { id name } }
        }
      `, { variables: { first: input.limit } })
    })

    await step('push-orders', async () => {
      if (signal.aborted) return
      await connectors.warehouse.push(orders)
    })
  },
})
```

## Steps

`step(name, fn)` stores completed output. If a run is retried, completed steps are skipped and their stored output is returned.

Step output must be JSON serializable.

## Sleep

Use `step.sleep(name, durationMs)` for delayed continuation without holding a worker slot.

```ts
await step.sleep('wait-for-rate-limit', 30_000)
```

## Timeout behavior

Flow and step timeouts mark the OpenShop execution as failed, but JavaScript cannot automatically cancel arbitrary user code. Use `ctx.signal` in long-running work and pass it to abortable APIs such as `fetch`.
