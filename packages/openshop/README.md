# OpenShop

OpenShop is a Shopify integration framework for apps that need typed flows, provider configuration, background workers, and an embedded admin UI.

- Website: https://openshop.run/
- Documentation: https://docs.openshop.run/

OpenShop is in beta. APIs, generated files, and documented workflows may change before a stable `1.0` release.

## Create an app

Generate a new OpenShop app instead of cloning the framework repository:

```bash
pnpm dlx openshop init my-app
cd my-app
pnpm install
pnpm run shopify
```

The generated app includes Shopify TOML files, Drizzle configuration, package scripts, a sample provider, and a sample flow.

## Project structure

```txt
my-app/
├─ flows/
├─ providers/
├─ proxy/
├─ webhooks/
├─ drizzle/
├─ openshop.app.ts
├─ openshop.config.ts
├─ drizzle.config.ts
├─ shopify.app.toml
├─ shopify.web.toml
├─ package.json
```

The generated `package.json` defines aliases such as `#app`, `#flows/*`, and `#providers/*`, so app code does not need `../` imports.

## Define a provider

```ts
import { type } from 'arktype'
import { defineProvider } from 'openshop'

export const warehouse = defineProvider({
  name: 'warehouse',
  ui: {
    fields: {
      apiUrl: { type: 'text', label: 'API URL', validate: type('string.url') },
      apiKey: { type: 'password', label: 'API key', validate: type('string > 0') },
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
```

## Define a flow

```ts
import { app } from '#app'

export const syncOrders = app.defineFlow({
  name: 'syncOrders',
  async run({ step, connectors }) {
    const orders = await step('fetch-orders', async () => [])
    await step('push-orders', async () => connectors.warehouse.push(orders))
  },
})
```

Register flows and crons in `openshop.config.ts`:

```ts
import { app } from '#app'
import { syncOrders } from '#flows/syncOrders'

export default app.defineConfig({
  flows: { syncOrders },
  crons: [{ schedule: '*/5 * * * *', flow: 'syncOrders', shops: 'all' }],
})
```

## Production

Generate, review, and commit client-owned Drizzle migrations in development or CI:

```bash
pnpm exec openshop migrate generate
pnpm exec openshop migrate check
```

Apply committed migrations before starting production processes:

```bash
pnpm exec openshop migrate
```

Run the web server and worker separately:

```bash
pnpm exec openshop start
pnpm exec openshop worker --concurrency=5
```

`openshop start` and `openshop worker` do not run migrations.

Set `ENCRYPTION_KEY` in production to encrypt provider credentials and Shopify access tokens:

```bash
openssl rand -hex 32
```

## Multiple Shopify apps

OpenShop can serve several Shopify apps from one production instance when the apps share the same scopes:

```ts
import { defineOpenShop } from 'openshop'

const app = defineOpenShop({ providers: {} })

export default app.defineConfig({
  shopify: {
    scopes: 'read_products,write_products',
    apps: {
      clientA: {
        toml: 'shopify.app.client-a.toml',
        apiSecret: process.env.SHOPIFY_CLIENT_A_API_SECRET!,
      },
      clientB: {
        apiKey: process.env.SHOPIFY_CLIENT_B_API_KEY!,
        apiSecret: process.env.SHOPIFY_CLIENT_B_API_SECRET!,
        appUrl: 'https://openshop.example.com',
      },
    },
  },
  flows: {},
})
```

Installations and shop-scoped data are isolated by `(appHandle, shop)`. If you use several Shopify TOML files, deploy each one with Shopify CLI, for example `shopify app deploy --config shopify.app.client-a.toml`.

## License

OpenShop is source-available under the Elastic License 2.0.

You may use, modify, and redistribute OpenShop, including for internal production use and client projects. You may not provide OpenShop to third parties as a hosted or managed service where users get access to a substantial set of OpenShop's features.

Read the LICENSE file for the full terms.
