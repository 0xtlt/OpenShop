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

## Top-level options

| Option | Type | Required | Default |
| --- | --- | --- | --- |
| `providers` | `Record<string, ProviderDefinition>` | Yes | — |
| `flows` | `Record<string, FlowDefinition>` | Yes | — |
| `shopify` | `ShopifyConfig` | No | Single app resolved from env and Shopify TOML |
| `functions` | `Record<string, FunctionDefinition>` | No | `{}` |
| `mcp` | `McpConfig` | No | Core MCP capabilities enabled; no custom capabilities |
| `webhooks` | `Record<string, WebhookDefinition>` | No | `{}` |
| `crons` | `CronEntry[]` | No | `[]` |
| `worker` | `Partial<WorkerConfig>` | No | See [Worker defaults](#worker-defaults) |
| `retryPolicy` | `Partial<RetryPolicy>` | No | See [Retry defaults](#retry-defaults) |
| `onError` | `(error, context?) => void \| Promise<void>` | No | No hook |

`providers` and `flows` are always present, even when empty. `defineOpenShop({ providers })` supplies the provider registry to `app.defineConfig()`.

## Shopify

Omitting `shopify.apps` enables single-app mode:

- `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` provide the credentials;
- `HOST`, then `SHOPIFY_APP_URL`, provides the public app URL;
- `shopify.scopes`, or the first matching `shopify.app*.toml`, provides scopes.

For multiple apps, define one entry per stable app handle:

```ts
export default app.defineConfig({
  shopify: {
    scopes: 'read_products,read_orders',
    apps: {
      retail: {
        toml: 'shopify.app.retail.toml',
        apiSecret: process.env.SHOPIFY_RETAIL_API_SECRET!,
      },
      wholesale: {
        apiKey: process.env.SHOPIFY_WHOLESALE_API_KEY!,
        apiSecret: process.env.SHOPIFY_WHOLESALE_API_SECRET!,
        appUrl: process.env.SHOPIFY_WHOLESALE_APP_URL,
      },
    },
  },
  flows: {},
})
```

| Field | Type | Behavior |
| --- | --- | --- |
| `shopify.scopes` | `string` | Global non-empty scope string. All configured apps share it. |
| `shopify.apps` | `Record<string, ShopifyAppConfig>` | Enables multi-app mode. Handles may contain letters, numbers, `_`, and `-`. |
| `apps.*.toml` | `string` | Reads `client_id` and `application_url` from this project-relative TOML path. Mutually exclusive with `apiKey`. |
| `apps.*.apiKey` | `string` | Client ID for a non-TOML app. Required when `toml` is omitted. |
| `apps.*.apiSecret` | `string` | Required non-empty secret. Keep it in an environment variable. |
| `apps.*.appUrl` | `string` | Optional URL override. TOML entries otherwise use `application_url`, `HOST`, then `SHOPIFY_APP_URL`; non-TOML entries use `HOST`, then `SHOPIFY_APP_URL`. |

Per-app scopes are not supported. If `shopify.scopes` is omitted, all configured app TOML files must resolve to the same scope string.

## Flows

The object key is the registered flow name used by dispatch and cron configuration.

| Field | Type | Default |
| --- | --- | --- |
| `name` | `string` | Required |
| `input` | ArkType `Type<TInput>` | No schema validation |
| `timeout` | positive number in milliseconds | No run deadline |
| `stepTimeout` | positive number in milliseconds | No default step deadline |
| `concurrency` | `'reject' \| 'allow'` | `'reject'` |
| `retryPolicy` | `Partial<RetryPolicy>` | Inherits the app retry policy |
| `run` | async function | Required |

An individual `step(name, fn, { timeout })` can override `stepTimeout`.

## Crons

| Field | Type | Default |
| --- | --- | --- |
| `name` | `string` | Omitted; display logs fall back to the flow name |
| `schedule` | cron expression string | Required |
| `flow` | registered flow key | Required |
| `input` | the selected flow input | `{}` |
| `shops` | `'global' \| 'all' \| string \| string[]` | `'global'` |

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

## Worker defaults

`worker` accepts a partial object. Missing fields use these runtime defaults:

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `concurrency` | positive integer | `5` | Maximum active runs in one worker process. |
| `pollIntervalMs` | positive number | `1000` | Initial queue polling interval and delay while all slots are occupied. |
| `pollMaxIntervalMs` | positive number | `5000` | Maximum empty-queue backoff. |
| `pollBackoffCoefficient` | positive number | `1.5` | Multiplier applied after consecutive empty polls. |
| `leaseDurationMs` | positive number | `30000` | Claim lease and graceful-stop deadline. Active runs refresh their lease on heartbeat. |

The CLI flag `openshop worker --concurrency=N` overrides only `worker.concurrency` for that process. Run multiple worker processes to scale horizontally; PostgreSQL claims work with `FOR UPDATE SKIP LOCKED`.

## Retry defaults

The app-level `retryPolicy` is merged over these defaults. A flow-level policy and dispatch-level policy can override it more narrowly.

| Field | Type | Default |
| --- | --- | --- |
| `maxAttempts` | positive integer | `3` |
| `initialIntervalMs` | positive number | `1000` |
| `backoffCoefficient` | positive number | `2` |
| `maxIntervalMs` | positive number | `30000` |

Retry delay is `initialIntervalMs * backoffCoefficient^(attempt - 1)`, capped by `maxIntervalMs`. No retry is scheduled after `maxAttempts`, or when the next retry would be at or beyond the flow deadline.

## Environment variables

`openshop dev` loads `.env` from the project root and preserves variables already present in the process. Production commands expect the deployment platform to inject variables.

| Variable | Default | Used for |
| --- | --- | --- |
| `DATABASE_URL` | Local OpenShop PostgreSQL URL in CLI commands | PostgreSQL connection. Set it explicitly outside local development. |
| `PORT` | `3000` | Development UI and production HTTP port. The dev API uses `PORT + 1`. |
| `SHOPIFY_API_KEY` | Empty | Single-app client ID and App Bridge build value. |
| `SHOPIFY_API_SECRET` | Empty | Single-app OAuth, webhook, proxy, and session-token verification. |
| `HOST` | — | Preferred public app URL. |
| `SHOPIFY_APP_URL` | — | Public app URL fallback when `HOST` is absent. |
| `ENCRYPTION_KEY` | — | 64 hex characters (32 bytes) for AES-256-GCM encryption. Required when `NODE_ENV=production`; without it in development, secrets are stored in plaintext with a warning. |
| `PGPOOL_MAX` | `10` | Maximum PostgreSQL pool size per process. |
| `PGPOOL_IDLE_TIMEOUT_MS` | `30000` | Idle PostgreSQL connection timeout. |
| `PGPOOL_CONNECTION_TIMEOUT_MS` | `5000` | PostgreSQL connection timeout. |
| `NODE_ENV` | — | Enables production encryption and migration-generation safeguards when set to `production`. |

Generate a production encryption key with `openssl rand -hex 32`. Keep the same key across deploys: changing or losing it prevents existing encrypted provider configurations and Shopify tokens from being decrypted.
