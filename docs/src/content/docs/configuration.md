---
title: Configuration
description: Configure providers, flows, functions, webhooks, crons, workers, and retry policy.
---

OpenShop apps export a default config from `openshop.config.ts`.

```ts
import { defineConfig, cron } from 'openshop'
import { syncOrders } from './flows/syncOrders'
import { warehouse } from './providers/warehouse'

export default defineConfig({
  providers: { warehouse },
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

## Runtime validation

`defineConfig()` validates the runtime shape early:

- cron entries must reference registered flows;
- providers and functions must declare valid fields;
- Shopify Function handles must be unique;
- worker and retry numbers must be positive;
- flow timeouts and step timeouts must be positive when set.

## Shopify apps

By default, OpenShop keeps the single-app path simple: omit `shopify.apps` and OpenShop reads the legacy Shopify credentials from `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `HOST`, and `shopify.app.toml` when present.

For one production OpenShop instance serving multiple Shopify apps, declare each app under `shopify.apps`. OpenShop isolates installations, access tokens, flow runs, provider configs, and cron overrides by `(appHandle, shop)`.

### With Shopify TOML

Use this mode when each Shopify app has its own `shopify.app*.toml` file. OpenShop reads `client_id`, `application_url`, and TOML scopes from the file. Keep `apiSecret` in environment-backed config, not in TOML.

```ts
import { defineConfig } from 'openshop'

export default defineConfig({
  shopify: {
    scopes: 'read_products,write_products',
    apps: {
      clientA: {
        toml: 'shopify.app.client-a.toml',
        apiSecret: process.env.SHOPIFY_CLIENT_A_API_SECRET!,
      },
      clientB: {
        toml: 'shopify.app.client-b.toml',
        apiSecret: process.env.SHOPIFY_CLIENT_B_API_SECRET!,
      },
    },
  },
  providers: {},
  flows: {},
})
```

All apps in one OpenShop instance must use the same scopes. Prefer setting `shopify.scopes` once, as above. If it is omitted, OpenShop reads scopes from TOML files and rejects mismatches.

This mirrors the direction of Gadget framework v1.7, where Shopify connection settings, scopes, and webhook subscriptions moved into TOML files. See the [Gadget v1.7 migration guide](https://docs.gadget.dev/guides/gadget-framework/v1-7-migration) and Shopify's [app configuration docs](https://shopify.dev/docs/apps/build/cli-for-apps/app-configuration).

### Without Shopify TOML

Use this mode for custom deployments where Shopify app configuration is not stored in local TOML files.

```ts
import { defineConfig } from 'openshop'

export default defineConfig({
  shopify: {
    scopes: 'read_products,write_products',
    apps: {
      clientA: {
        apiKey: process.env.SHOPIFY_CLIENT_A_API_KEY!,
        apiSecret: process.env.SHOPIFY_CLIENT_A_API_SECRET!,
        appUrl: 'https://openshop.example.com',
      },
      clientB: {
        apiKey: process.env.SHOPIFY_CLIENT_B_API_KEY!,
        apiSecret: process.env.SHOPIFY_CLIENT_B_API_SECRET!,
        appUrl: 'https://openshop.example.com',
      },
    },
  },
  providers: {},
  flows: {},
})
```

Unsigned entry points cannot be auto-detected. Use `/auth?shop=shop.myshopify.com&app=clientA` for manual OAuth starts when multiple apps are configured. Signed Shopify launches, OAuth callbacks, app proxy requests, webhooks, and App Bridge JWTs are resolved automatically from their HMAC or JWT audience.

## Cron shop targeting

Cron entries support these shop modes:

- `global`: run once without a shop context.
- `all`: run once per installed `(appHandle, shop)` installation.
- `shop.myshopify.com`: run only for one shop.
- `['a.myshopify.com', 'b.myshopify.com']`: run for selected shops.
