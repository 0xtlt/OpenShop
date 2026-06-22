# OpenShop

Shopify integration framework. Define flows, connect providers, get an admin UI — zero boilerplate.

## Beta status

OpenShop is currently in beta. APIs, configuration shape, generated files, and documented workflows are subject to change before a stable `1.0` release.

## What it does

You write **flows** (jobs with checkpointed steps) and **providers** (external connectors), OpenShop handles the rest: scheduling, retries, logging, admin dashboard, and Shopify embedding.

## Stack

Node.js 26, pnpm, Hono, Drizzle + PostgreSQL, Preact, Vite 8, ArkType, Polaris Web Components

## Quick start

```bash
pnpm dlx openshop init my-app
cd my-app
pnpm install
pnpm run shopify
```

## Project structure

```
my-app/
  openshop.app.ts                # OpenShop app builder + providers
  openshop.config.ts    # Flows, providers, crons
  flows/
    syncOrders.ts       # Your flows
  providers/
    warehouse.ts        # Your connectors
  shopify.app.toml      # Shopify app config
  shopify.web.toml      # Dev server config
```

## Define a flow

```ts
import { app } from '../openshop.app'

export const syncOrders = app.defineFlow({
  name: 'syncOrders',

  async run({ connectors, step, logger }) {
    const orders = await step('fetch-orders', async () => {
      // Fetch from Shopify API
      return [{ id: 1, name: '#1001' }]
    })

    await step('send-to-warehouse', async () => {
      await connectors.warehouse.push(orders)
    })
  },
})
```

Each `step()` is checkpointed. If the flow fails mid-way, only failed steps re-run on retry.

## Define a provider

```ts
import { defineProvider } from 'openshop'
import { type } from 'arktype'

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
        label: 'API Key',
        validate: type('string > 0'),
      },
    },
  },

  // `config` is auto-typed from fields: { apiUrl: string, apiKey: string }
  async checker({ config }) {
    const res = await fetch(`${config.apiUrl}/health`)
    return res.ok
  },

  methods: {
    async push(config, data: unknown[]) { /* ... */ },
  },
})
```

The admin UI auto-generates a config form from `ui.fields` with validation.

## Define an app

```ts
import { defineOpenShop } from 'openshop'
import { warehouse } from './providers/warehouse'

export const app = defineOpenShop({
  providers: { warehouse },
})
```

## Config

```ts
import { app } from './openshop.app'
import { syncOrders } from './flows/syncOrders'

export default app.defineConfig({
  flows: { syncOrders },
  crons: [
    { schedule: '*/5 * * * *', flow: 'syncOrders' },
  ],
  onError: async (error, ctx) => {
    // Slack, Sentry, etc.
  },
})
```

## Admin UI

Auto-generated pages inside Shopify admin:

- **Home** — Dashboard with flow/provider status
- **Flows** — List flows, trigger runs, view execution history
- **Flow Run** — Step-by-step execution detail with log viewer
- **Providers** — Configure connectors with auto-generated forms

### Log query syntax

The log viewer supports Grafana-style queries:

```
|= "text"          Contains (case-insensitive)
!= "text"          Excludes
|~ "regex"         Regex match
C:N                Context lines around matches
B:N / A:N          Before / After context
last:5m            Last 5 minutes (s/m/h/d)
from:ISO to:ISO    Absolute date range
```

## Shopify integration

Works with `shopify app dev`:

```bash
shopify app config link           # Link to your Partner app
shopify app dev --skip-dependencies-installation
```

The framework handles App Bridge, Cloudflare tunnels, and embedded app setup.

### Multiple Shopify apps

One OpenShop instance can serve multiple Shopify apps when all apps use the same scopes. Declare them in `openshop.config.ts` with TOML files:

```ts
import { defineOpenShop } from 'openshop'

const app = defineOpenShop({ providers: {} })

export default app.defineConfig({
  shopify: {
    scopes: 'read_products,write_products',
    apps: {
      clientA: { toml: 'shopify.app.client-a.toml', apiSecret: process.env.SHOPIFY_CLIENT_A_API_SECRET! },
      clientB: { toml: 'shopify.app.client-b.toml', apiSecret: process.env.SHOPIFY_CLIENT_B_API_SECRET! },
    },
  },
  flows: {},
})
```

Or without TOML:

```ts
import { defineOpenShop } from 'openshop'

const app = defineOpenShop({ providers: {} })

export default app.defineConfig({
  shopify: {
    scopes: 'read_products,write_products',
    apps: {
      clientA: { apiKey: process.env.SHOPIFY_CLIENT_A_API_KEY!, apiSecret: process.env.SHOPIFY_CLIENT_A_API_SECRET!, appUrl: 'https://openshop.example.com' },
      clientB: { apiKey: process.env.SHOPIFY_CLIENT_B_API_KEY!, apiSecret: process.env.SHOPIFY_CLIENT_B_API_SECRET!, appUrl: 'https://openshop.example.com' },
    },
  },
  flows: {},
})
```

Data is isolated by `(appHandle, shop)`. For TOML-based setups, deploy every Shopify app config separately with Shopify CLI, for example `shopify app deploy --config shopify.app.client-a.toml`.

## Development

```bash
# Monorepo structure
packages/openshop/    # The framework
apps/demo/            # Demo app

# Install
pnpm install

# Database
docker compose up -d postgres
# Creates both openshop and openshop_test

# Checks
pnpm run check
pnpm run coverage:unit
pnpm run coverage:integration
pnpm run coverage:demo

# Dev (standalone)
cd apps/demo && pnpm run dev

# Dev (with Shopify)
cd apps/demo && pnpm run shopify

# Production build
cd apps/demo && pnpm run build
# Generates dist/ui and dist/openshop/server
```

Production requires `ENCRYPTION_KEY` to be set. Generate one with:

```bash
openssl rand -hex 32
```

Use versioned Drizzle migrations for production schema changes. `openshop dev` still uses `drizzle-kit push --force` for local development only.
OpenShop projects own their migrations in `./drizzle`, including framework tables and app models:

```bash
pnpm exec openshop migrate generate
pnpm exec openshop migrate check
pnpm exec openshop migrate
```

Run `generate` and `check` in development or CI where Drizzle Kit is installed. Review and commit generated migration files before deploying. In production/deploy jobs, `openshop migrate` only applies already committed SQL from `./drizzle`; it does not load `drizzle.config.ts` or run generation tooling. `openshop start` and `openshop worker` never generate or apply migrations.

### Production processes

`openshop start` intentionally starts only the HTTP server: API, embedded admin UI, proxy routes, webhooks, and cron dispatch.
It does **not** execute queued flow runs.

Run at least one worker process separately:

```bash
pnpm exec openshop start
pnpm exec openshop worker --concurrency=5
```

This separation is deliberate:

- web and worker can be restarted independently;
- worker concurrency is explicit;
- production apps can scale workers without multiplying HTTP servers;
- `openshop start` stays predictable for platforms that expect one web process.

For a single-container deployment, use a process manager such as PM2:

```js
// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'my-app-web',
      script: 'node_modules/openshop/bin/cli.js',
      args: 'start',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'my-app-worker',
      script: 'node_modules/openshop/bin/cli.js',
      args: 'worker --concurrency=5',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
    },
  ],
}
```

```dockerfile
CMD ["pnpm", "exec", "pm2-runtime", "start", "ecosystem.config.cjs"]
```

Use `node_modules/openshop/bin/cli.js` rather than `node_modules/.bin/openshop` in PM2 configs. The `.bin` file is a shell shim, and PM2 can try to execute it as JavaScript.

`openshop start` and `openshop worker` load the compiled server app from `dist/openshop/server`; run `openshop build` before starting production.

### Database migrations

OpenShop does not ship prebuilt framework migration SQL. A generated project creates its first migration in `./drizzle` from the OpenShop framework schema. Later schema changes, including app-specific Drizzle models, should be generated manually:

```bash
pnpm exec openshop migrate generate
pnpm exec openshop migrate
```

Run `openshop migrate generate` before deploy, review and commit the SQL, then run `openshop migrate` during deploy. Without a worker process, runs can stay `pending` forever. Without running migrations manually before deploy, web and worker processes can start and then fail when they read or write missing tables.

## License

OpenShop is source-available under the Elastic License 2.0.

You may use, modify, and redistribute OpenShop, including for internal production use and client projects. You may not provide OpenShop to third parties as a hosted or managed service where users get access to a substantial set of OpenShop's features.

Read the LICENSE file for the full terms.
