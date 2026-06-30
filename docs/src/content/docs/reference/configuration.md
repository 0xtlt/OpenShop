---
title: Configuration
description: Options accepted by app.defineConfig().
---

OpenShop apps export a default config from `openshop.config.ts`.

```ts
import { cron } from 'openshop'
import { app } from '#app'
import { syncOrders } from '#flows/syncOrders'

export default app.defineConfig({
  flows: { syncOrders },
  crons: [
    { name: 'Quick sync', schedule: cron('*/5 * * * *'), flow: 'syncOrders', shops: 'all' },
  ],
  worker: {
    concurrency: 5,
  },
  retryPolicy: {
    maxAttempts: 3,
    initialIntervalMs: 1000,
    backoffCoefficient: 2,
    maxIntervalMs: 30000,
  },
  onError(error, context) {
    console.error('[openshop:error]', context, error)
  },
})
```

## Options

| Option | Purpose |
| --- | --- |
| `shopify` | Single-app or multi-app Shopify configuration. |
| `flows` | Registered flow definitions. |
| `functions` | Shopify Function admin UI definitions. |
| `mcp` | MCP permissions, tools, and resources. |
| `webhooks` | Shopify webhook handlers keyed by topic. |
| `crons` | Scheduled flow dispatch entries. |
| `worker` | Worker defaults such as concurrency. |
| `retryPolicy` | Default retry behavior for flow runs. |
| `onError` | Runtime error hook. |

## Runtime validation

`app.defineConfig()` validates the runtime shape early:

- cron entries must reference registered flows;
- providers and functions must declare valid fields;
- Shopify Function handles must be unique;
- worker and retry numbers must be positive;
- flow timeouts and step timeouts must be positive when set.

## Cron shop targeting

Cron entries support these shop modes:

| Value | Behavior |
| --- | --- |
| `global` | Run once without a shop context. |
| `all` | Run once per installed `(appHandle, shop)` installation. |
| `shop.myshopify.com` | Run only for one shop. |
| `['a.myshopify.com', 'b.myshopify.com']` | Run for selected shops. |
