---
title: Environment variables
description: Runtime, database, Shopify, encryption, and process environment variables used by OpenShop.
---

`openshop dev` loads `.env` from the project root. An environment variable
already present in the process wins over the value in `.env`. Production
commands such as `openshop start` and `openshop worker` expect the process
manager or deployment platform to inject their environment.

## Complete reference

| Variable | Required | Default | Used by |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | `postgresql://openshop:openshop@localhost:5432/openshop` for CLI commands | API, worker, schema commands, tests |
| `SHOPIFY_API_KEY` | Single-app mode | Empty | Shopify session-token audience and embedded App Bridge key |
| `SHOPIFY_API_SECRET` | Single-app mode | Empty | OAuth, session-token, webhook, and proxy signature verification |
| `HOST` | Production | Falls back to `SHOPIFY_APP_URL` | Public application URL and allowed CORS origin |
| `SHOPIFY_APP_URL` | When `HOST` is absent | Empty | Legacy public application URL and allowed CORS origin |
| `ENCRYPTION_KEY` | Production | Plaintext storage in development | Provider configuration and Shopify access-token encryption |
| `PORT` | No | `3000` | `openshop dev` UI port and `openshop start` HTTP port |
| `OPENSHOP_API_PORT` | Internal | `3001` | Development API subprocess |
| `PGPOOL_MAX` | No | `10` | Maximum PostgreSQL pool connections per process |
| `PGPOOL_IDLE_TIMEOUT_MS` | No | `30000` | Idle PostgreSQL connection timeout |
| `PGPOOL_CONNECTION_TIMEOUT_MS` | No | `5000` | PostgreSQL connection acquisition timeout |
| `NODE_ENV` | No | Command/runtime dependent | Production safety checks and encryption enforcement |

`OPENSHOP_API_PORT` is an implementation detail of `openshop dev`. Do not set it in
normal production deployments.

## Minimal single-app `.env`

```dotenv
DATABASE_URL=postgresql://openshop:openshop@localhost:5432/openshop
SHOPIFY_API_KEY=your-client-id
SHOPIFY_API_SECRET=your-client-secret
HOST=https://your-app.example.com
ENCRYPTION_KEY=replace-with-64-hex-characters
```

Generate the encryption key once:

```bash
openssl rand -hex 32
```

The key must remain stable. Changing or losing it makes encrypted provider
credentials and Shopify access tokens unreadable.

## Multi-app configuration

In multi-app mode, API keys and secrets come from `openshop.config.ts`, usually with
secrets read from your own environment variable names:

```ts
import { defineOpenShop } from 'openshop'

const app = defineOpenShop({ providers: {} })

export default app.defineConfig({
  shopify: {
    scopes: 'read_orders,write_products',
    apps: {
      retail: {
        toml: 'shopify.app.retail.toml',
        apiSecret: process.env.RETAIL_SHOPIFY_API_SECRET!,
      },
      wholesale: {
        apiKey: process.env.WHOLESALE_SHOPIFY_API_KEY!,
        apiSecret: process.env.WHOLESALE_SHOPIFY_API_SECRET!,
        appUrl: process.env.WHOLESALE_APP_URL!,
      },
    },
  },
  flows: {},
})
```

OpenShop does not assign special meaning to `RETAIL_SHOPIFY_API_SECRET`,
`WHOLESALE_SHOPIFY_API_KEY`, or `WHOLESALE_APP_URL`; they are application-defined
variables read by this example.

## Resolution priority

### Development `.env`

1. Existing process environment
2. Project-root `.env`
3. Development CLI fallback, where one exists

The `.env` loader does not overwrite an existing process variable and is used by
`openshop dev`, not by production process commands.

### Shopify app URL

For a configured app, resolution is:

1. `shopify.apps.<handle>.appUrl`
2. `application_url` in that app's TOML file
3. `HOST`
4. `SHOPIFY_APP_URL`

For legacy single-app mode, resolution is `HOST`, then `SHOPIFY_APP_URL`.

### Shopify scopes

1. `shopify.scopes` in `openshop.config.ts`
2. `scopes` in the selected Shopify TOML file
3. Empty string

When multiple apps are configured without global `shopify.scopes`, their TOML
scopes must be identical.

## Database pool sizing

Pool settings apply **per process**. A deployment with one web process and three
workers at the default `PGPOOL_MAX=10` can open up to 40 PostgreSQL connections.
Choose `PGPOOL_MAX` from the database connection limit divided by the maximum number
of simultaneously running web and worker processes, leaving capacity for migrations
and administration.

## Production rules

- Set `NODE_ENV=production` in production.
- Set a persistent, secret `ENCRYPTION_KEY`; OpenShop refuses encrypted writes
  without one in production.
- Use an externally reachable HTTPS `HOST`.
- Never expose `SHOPIFY_API_SECRET`, `ENCRYPTION_KEY`, or `DATABASE_URL` to browser
  code.
- Give the web and worker processes the same database, encryption key, app
  configuration, and application build.
