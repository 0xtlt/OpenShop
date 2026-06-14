# OpenShop

Shopify integration framework. Define flows, connect providers, get an embedded admin UI, and run background jobs with checkpointed steps.

## Beta status

OpenShop is currently in beta. APIs, configuration shape, generated files, and documented workflows are subject to change before a stable `1.0` release.

## Install

```bash
pnpm dlx openshop init my-app
cd my-app
pnpm install
pnpm run shopify
```

## Core API

```ts
import { defineConfig, defineFlow, defineProvider } from 'openshop'

const syncOrders = defineFlow({
  name: 'syncOrders',
  async run({ step, connectors }) {
    const orders = await step('fetch-orders', async () => [])
    await step('push-orders', async () => connectors.warehouse.push(orders))
  },
})

const warehouse = defineProvider({
  name: 'warehouse',
  ui: {
    fields: {
      apiUrl: { type: 'text', label: 'API URL' },
      apiKey: { type: 'password', label: 'API key' },
    },
  },
  methods: {
    async push(config, rows: unknown[]) {
      await fetch(`${config.apiUrl}/orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify(rows),
      })
    },
  },
})

export default defineConfig({
  providers: { warehouse },
  flows: { syncOrders },
  crons: [{ schedule: '*/5 * * * *', flow: 'syncOrders', shops: 'all' }],
})
```

## Production

Run the web server and worker separately:

```bash
pnpm exec openshop start
pnpm exec openshop worker --concurrency=5
```

Set `ENCRYPTION_KEY` in production to encrypt provider credentials and Shopify access tokens:

```bash
openssl rand -hex 32
```

## Multiple Shopify apps

OpenShop can serve several Shopify apps from one production instance when the apps share the same scopes:

```ts
export default defineConfig({
  shopify: {
    scopes: 'read_products,write_products',
    apps: {
      clientA: { toml: 'shopify.app.client-a.toml', apiSecret: process.env.SHOPIFY_CLIENT_A_API_SECRET! },
      clientB: { apiKey: process.env.SHOPIFY_CLIENT_B_API_KEY!, apiSecret: process.env.SHOPIFY_CLIENT_B_API_SECRET!, appUrl: 'https://openshop.example.com' },
    },
  },
  providers: {},
  flows: {},
})
```

Installations and shop-scoped data are isolated by `(appHandle, shop)`. If you use several Shopify TOML files, deploy each one with Shopify CLI, for example `shopify app deploy --config shopify.app.client-a.toml`.

## Documentation

The repository contains the full documentation in `docs/`.

## License

OpenShop is source-available under the Elastic License 2.0.

You may use, modify, and redistribute OpenShop, including for internal production use and client projects. You may not provide OpenShop to third parties as a hosted or managed service where users get access to a substantial set of OpenShop's features.

For commercial platform integrations, hosted offerings, or managed services based on OpenShop, contact Thomas Tastet for a separate commercial license.
