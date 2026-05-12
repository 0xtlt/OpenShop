# OpenShop

Shopify integration framework. Define flows, connect providers, get an admin UI — zero boilerplate.

## What it does

You write **flows** (jobs with checkpointed steps) and **providers** (external connectors), OpenShop handles the rest: scheduling, retries, logging, admin dashboard, and Shopify embedding.

## Stack

Bun, Hono, Drizzle + SQLite, Preact, Vite 8, ArkType, Polaris Web Components

## Quick start

```bash
npx openshop init my-app
cd my-app
npm install
npm run shopify
```

## Project structure

```
my-app/
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
import { defineFlow } from 'openshop'

export const syncOrders = defineFlow({
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
    async push(data: unknown[]) { /* ... */ },
  },
})
```

The admin UI auto-generates a config form from `ui.fields` with validation.

## Config

```ts
import { defineConfig } from 'openshop'
import { syncOrders } from './flows/syncOrders'
import { warehouse } from './providers/warehouse'

export default defineConfig({
  providers: { warehouse },
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

## Development

```bash
# Monorepo structure
packages/openshop/    # The framework
apps/demo/            # Demo app

# Install
bun install

# Dev (standalone)
cd apps/demo && bun run dev

# Dev (with Shopify)
cd apps/demo && bun run shopify
```

## License

MIT
