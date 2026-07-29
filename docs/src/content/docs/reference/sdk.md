---
title: Public SDK
description: Runtime exports from the openshop package, their parameters, and stability.
---

Import the supported application API from `openshop`:

```ts
import {
  cron,
  createShopifyClient,
  defineModel,
  defineOpenShop,
  defineProvider,
  dispatchFlow,
  getDb,
  getRuntimeLogger,
  setRuntimeLogger,
} from 'openshop'
```

The exports documented on this page are public. Files below `openshop/src/` and
package-internal `#server/*`, `#engine/*`, and `#db/*` imports are not public APIs.

## `defineOpenShop(app)`

Creates an app-scoped definition API and carries provider types into flows.

```ts
import { defineOpenShop } from 'openshop'
import { warehouse } from './providers/warehouse.ts'

export const app = defineOpenShop({
  providers: { warehouse },
  worker: { concurrency: 5 },
  retryPolicy: { maxAttempts: 3 },
  onError(error, context) {
    console.error(context, error)
  },
})
```

Parameters:

- `providers`: provider definitions keyed by the connector name used in flows.
- `shopify`: optional single-app or multi-app Shopify configuration.
- `mcp`: optional MCP capabilities and permissions.
- `worker`: partial worker defaults.
- `retryPolicy`: partial flow retry defaults.
- `onError`: application error hook.

The returned object exposes:

- `defineFlow({ name, input?, timeout?, stepTimeout?, concurrency?, retryPolicy?, run })`
- `defineFunction({ type, handle, modes?, owner?, config })`
- `defineProxy({ type?, GET?, POST?, PUT?, DELETE?, PATCH? })`
- `defineWebhook({ run })`
- `defineConfig({ flows, functions?, webhooks?, crons?, ... })`

## `defineProvider(provider)`

Defines provider fields, validation, health checking, and connector methods while
preserving their TypeScript types.

```ts
import { type } from 'arktype'
import { defineProvider } from 'openshop'

export const warehouse = defineProvider({
  name: 'Warehouse',
  ui: {
    fields: {
      endpoint: {
        type: 'text',
        label: 'Endpoint',
        required: true,
        validate: type('string.url'),
      },
      token: {
        type: 'password',
        label: 'Token',
        required: true,
        validate: type('string'),
      },
    },
  },
  async checker({ config }) {
    const response = await fetch(`${config.endpoint}/health`, {
      headers: { Authorization: `Bearer ${config.token}` },
    })
    return response.ok
  },
  methods: {
    async push(config, orderId: string) {
      const response = await fetch(`${config.endpoint}/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ orderId }),
      })
      if (!response.ok) throw new Error(`Warehouse returned ${response.status}`)
      return response.json() as Promise<{ accepted: boolean }>
    },
  },
})
```

Each provider method receives the stored provider configuration as its first
argument. Flow connectors remove that first argument automatically.

## `cron(schedule)`

Validates standard five-field cron expressions and supported nicknames at compile
time, then returns the original string.

```ts
import { cron } from 'openshop'

const nightly = cron('0 3 * * *')
const hourly = cron('@hourly')
```

Supported nicknames are `@yearly`, `@annually`, `@monthly`, `@weekly`, `@daily`,
and `@hourly`.

## `dispatchFlow(params)`

Adds a flow run to PostgreSQL. A worker must be running to execute it.

```ts
import { dispatchFlow, type OpenShopConfig } from 'openshop'

export async function queueSync(config: OpenShopConfig) {
  return dispatchFlow({
    flowName: 'syncOrders',
    input: { limit: 50 },
    config,
    shop: 'example.myshopify.com',
    shopifyApp: 'default',
    parentRunId: undefined,
    options: {
      delayMs: 5_000,
      retryPolicy: { maxAttempts: 5 },
    },
  })
}
```

| Parameter | Type | Notes |
| --- | --- | --- |
| `flowName` | `string` | Must exist in `config.flows`. |
| `input` | `Record<string, unknown>` | Defaults to `{}`. |
| `config` | `OpenShopConfig` | Active application config. |
| `shop` | `string` | Target `*.myshopify.com` domain, or the cron global sentinel when used internally. |
| `shopifyApp` | `string` | Defaults to the `default` app handle. |
| `parentRunId` | `string` | Optional parent run relationship. |
| `options.delayMs` | `number` | Delays the initial `availableAt`. |
| `options.retryPolicy` | `Partial<RetryPolicy>` | Highest-priority retry override for this run. |

Returns `{ runId, status: 'pending' }`. It throws when the flow is missing or when
a flow with `concurrency: 'reject'` already has an active run for the same app and
shop.

## `createShopifyClient(shop, appOrVersion?, apiVersion?)`

Creates a Shopify Admin GraphQL client from the encrypted offline access token in
the installations table.

```ts
import { createShopifyClient } from 'openshop'

const shopify = await createShopifyClient(
  'example.myshopify.com',
  'default',
  '2026-04',
)

const data = await shopify.graphql(`#graphql
  query ShopName {
    shop { name }
  }
`)
```

- `shop` is the installed shop domain.
- The second argument is an app handle. For backward compatibility, a `YYYY-MM`
  value is treated as the API version for the default app.
- `apiVersion` defaults to `2026-04`.
- `graphql()` returns Shopify's `data` object directly and throws for HTTP or
  top-level GraphQL errors.

## `getDb()`

Returns the shared Drizzle PostgreSQL client, initialized from `DATABASE_URL`.

```ts
import { eq } from 'drizzle-orm'
import { getDb } from 'openshop'
import { reviews } from './models/review.ts'

const db = getDb()
const rows = await db.select().from(reviews).where(eq(reviews.rating, 5))
```

Framework tables are available through `openshop/schema`; application models should
be imported from their defining files.

## `defineModel(name, columns, options?)`

Defines an application-owned PostgreSQL table. By default it adds an
auto-generated UUID `id` primary key, a non-null `shop` column, and `createdAt`
/ `updatedAt` timestamps. Add indexes explicitly with `options.indexes`.

```ts
import { integer, text } from 'drizzle-orm/pg-core'
import { defineModel } from 'openshop'

export const reviews = defineModel('reviews', {
  productId: text('product_id').notNull(),
  rating: integer('rating').notNull(),
}, {
  updatedAt: false,
})
```

Set `shop`, `createdAt`, or `updatedAt` to `false` in the third argument to omit
that generated column. `indexes(table)` can return custom Drizzle indexes and
constraints.

Include model files in the application Drizzle configuration before generating or
pushing the schema.

## Runtime logging

`setRuntimeLogger(logger)` replaces OpenShop's process-wide runtime logger and
returns the previous logger. `getRuntimeLogger()` returns the current logger.

```ts
import {
  getRuntimeLogger,
  setRuntimeLogger,
  type RuntimeLogger,
} from 'openshop'

const logger: RuntimeLogger = {
  info(message, context) {
    console.info(JSON.stringify({ level: 'info', message, ...context }))
  },
  warn(message, context) {
    console.warn(JSON.stringify({ level: 'warn', message, ...context }))
  },
  error(message, context) {
    console.error(JSON.stringify({ level: 'error', message, ...context }))
  },
}

const previous = setRuntimeLogger(logger)
getRuntimeLogger().info('OpenShop logger configured')

// Restore in a test or during shutdown.
setRuntimeLogger(previous)
```

This logger handles framework/process messages. Flow code should normally use
`ctx.logger`, which persists records in the run log.

## Public type exports

The package root exports types for configuration, flows, providers, webhooks,
proxies, Shopify Functions, MCP, workers, retry and dispatch options, the Shopify
client, and runtime logging. Prefer importing those types from `openshop` instead
of source paths.
