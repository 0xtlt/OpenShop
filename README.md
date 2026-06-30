# OpenShop

OpenShop is a Shopify integration framework for apps that need typed flows, provider configuration, background workers, and an embedded admin UI.

- Website: https://openshop.run/
- Documentation: https://docs.openshop.run/

OpenShop is in beta. APIs, generated files, and documented workflows may change before a stable `1.0` release.

## What you get

- Shopify OAuth, embedded app routing, and stored shop access.
- Checkpointed flows for jobs that need retries, logs, and resumable steps.
- Provider definitions that generate typed configuration forms in the admin UI.
- Cron schedules, manual flow runs, execution history, and log search.
- PostgreSQL storage through Drizzle migrations owned by the generated app.
- Proxy routes, webhooks, Shopify Functions helpers, and typed Admin GraphQL support.

## Quick start

Do not clone this repo to start an app. Generate a new OpenShop app instead:

```bash
pnpm dlx openshop init my-app
cd my-app
pnpm install
pnpm run shopify
```

`pnpm run shopify` runs Shopify CLI development for the generated app. Shopify CLI handles Partner app linking, the development tunnel, and launching the embedded app in a development store.

## Prerequisites

- Node.js 26
- pnpm 11
- Shopify CLI
- A Shopify Partner app and development store
- PostgreSQL for local and production storage

The generated template defaults to:

```bash
DATABASE_URL=postgresql://openshop:openshop@localhost:5432/openshop
```

## Project structure

A generated app contains the OpenShop app definition, config, sample provider, sample flow, Shopify TOML files, Drizzle config, and package scripts.

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

The generated `package.json` also defines Node.js import aliases, so app code can use `#app`, `#flows/*`, `#providers/*`, `#webhooks/*`, and related aliases instead of `../` imports.

## Define your app

Create providers in `providers/`, register them in `openshop.app.ts`, then register flows, crons, webhooks, and runtime options in `openshop.config.ts`.

```ts
import { defineOpenShop } from 'openshop'
import { warehouse } from '#providers/warehouse'

export const app = defineOpenShop({
  providers: { warehouse },
})
```

## Define a provider

Providers describe external systems and the configuration fields a merchant can edit from the embedded admin UI.

```ts
import { type } from 'arktype'
import { defineProvider } from 'openshop'

export const warehouse = defineProvider({
  name: 'warehouse',
  ui: {
    fields: {
      apiUrl: {
        type: 'text',
        label: 'API URL',
        validate: type('string.url'),
      },
      apiKey: {
        type: 'password',
        label: 'API key',
        validate: type('string > 0'),
      },
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

Flows are background jobs. Each `step()` is checkpointed, so retries keep completed work and rerun only the failed part.

```ts
import { app } from '#app'

export const syncOrders = app.defineFlow({
  name: 'syncOrders',

  async run({ connectors, shopify, step }) {
    const orders = await step('fetch-orders', async () => {
      return shopify.graphql(`#graphql
        query RecentOrders {
          orders(first: 10) {
            nodes { id name }
          }
        }
      `)
    })

    await step('push-orders', async () => {
      await connectors.warehouse.push(orders)
    })
  },
})
```

Register the flow in `openshop.config.ts`:

```ts
import { app } from '#app'
import { syncOrders } from '#flows/syncOrders'

export default app.defineConfig({
  flows: { syncOrders },
  crons: [
    { schedule: '*/5 * * * *', flow: 'syncOrders', shops: 'all' },
  ],
})
```

## Local development

```bash
pnpm run shopify
```

For direct OpenShop development without Shopify CLI:

```bash
pnpm run dev
```

Common generated scripts:

```bash
pnpm run codegen
pnpm run lint
pnpm run test
pnpm run build
```

## Production

### Application storage

OpenShop stores installations, provider configuration, flow runs, step checkpoints, logs, and cron state in PostgreSQL. Configure production storage with `DATABASE_URL`.

Drizzle migrations live in `./drizzle` inside the generated app and should be committed with the app code.

### Build

Build the app, apply committed migrations, then run the web and worker processes separately.

```bash
pnpm run build
pnpm exec openshop migrate
pnpm exec openshop start
pnpm exec openshop worker --concurrency=5
```

Generate and review Drizzle migrations during development or CI:

```bash
pnpm exec openshop migrate generate
pnpm exec openshop migrate check
```

`openshop start` and `openshop worker` do not generate or apply migrations. Commit the generated SQL in `./drizzle`, then run `openshop migrate` during deployment.

Set `ENCRYPTION_KEY` in production to encrypt provider credentials and Shopify access tokens:

```bash
openssl rand -hex 32
```

## Multiple Shopify apps

One OpenShop instance can serve multiple Shopify apps when all apps use the same scopes.

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

Installations and shop-scoped data are isolated by `(appHandle, shop)`. If you use several Shopify TOML files, deploy each one with Shopify CLI:

```bash
shopify app deploy --config shopify.app.client-a.toml
```

## Troubleshooting

### Missing database tables

Run migrations before starting production processes:

```bash
pnpm exec openshop migrate
```

### Invalid or missing encryption key

Production requires a 64-character hex `ENCRYPTION_KEY`. Generate one with:

```bash
openssl rand -hex 32
```

### GraphQL types are stale

Run codegen again:

```bash
pnpm run codegen
```

## Developing OpenShop itself

This repository is the framework monorepo.

```bash
pnpm install
pnpm run check
pnpm run coverage:unit
pnpm run coverage:integration
pnpm run coverage:demo
```

Key workspaces:

```txt
apps/demo/
packages/openshop/
docs/
```

## Resources

- Website: https://openshop.run/
- Documentation: https://docs.openshop.run/
- Shopify CLI: https://shopify.dev/docs/apps/tools/cli
- Shopify app template for React Router: https://github.com/Shopify/shopify-app-template-react-router

## License

OpenShop is source-available under the Elastic License 2.0.

You may use, modify, and redistribute OpenShop, including for internal production use and client projects. You may not provide OpenShop to third parties as a hosted or managed service where users get access to a substantial set of OpenShop's features.

Read the LICENSE file for the full terms.
