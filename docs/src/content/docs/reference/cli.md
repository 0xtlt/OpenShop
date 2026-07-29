---
title: CLI commands
description: Commands exposed by the OpenShop template and CLI.
---

The minimal template exposes OpenShop commands through package scripts.

| Script | Command | Purpose |
| --- | --- | --- |
| `pnpm run dev` | `openshop dev` | Start the development server. |
| `pnpm run build` | `openshop build` | Build the app for production. |
| `pnpm run start` | `openshop start` | Start the production web process. |
| `pnpm run worker` | `openshop worker` | Start the worker process. |
| `pnpm run db:generate` | `openshop migrate generate` | Generate Drizzle migrations. |
| `pnpm run db:migrate` | `openshop migrate` | Apply committed migrations. |
| `pnpm run db:check` | `openshop migrate check` | Check migration consistency. |
| `pnpm run db:status` | `openshop migrate status` | Inspect migration status. |
| `pnpm run codegen` | `openshop codegen` | Generate Shopify GraphQL operation types. |
| `pnpm run codegen:watch` | `openshop codegen:watch` | Watch GraphQL operations during development. |
| `pnpm run shopify` | `shopify app dev --skip-dependencies-installation` | Run Shopify CLI development. |
| `pnpm run test` | `openshop test` | Run OpenShop app tests. |
| `pnpm run lint` | `pnpm run codegen && tsc --noEmit && eslint .` | Validate generated types, TypeScript, and lint rules. |

## Development process

`pnpm run shopify` executes Shopify CLI. Shopify CLI reads `[commands].dev = "pnpm run dev"` from `shopify.web.toml`, so it also starts OpenShop. Do not start a second `pnpm run dev` process.

When run directly, `openshop dev` starts the API, admin UI, worker, and cron scheduler in one development process. It also runs optional codegen and pushes the local schema before listening.

## Production build and migration

Run finite setup commands in this order:

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm exec openshop migrate
```

`openshop migrate` applies committed SQL from `./drizzle`; it does not generate migrations. Run `openshop migrate generate` during development, then review and commit the SQL.

## Production processes

After the build and migration complete, configure two independently supervised long-running services:

| Service | Command | Responsibility |
| --- | --- | --- |
| Web | `pnpm exec openshop start` | HTTP API, admin UI, webhooks, OAuth, and cron dispatch |
| Worker | `pnpm exec openshop worker --concurrency=5` | Claim and execute queued flow runs |

Do not put both commands sequentially in one shell script: `openshop start` keeps running, so the shell never reaches the worker command. The generated `ecosystem.config.cjs` provides both process definitions for PM2-based deployments.

Each service needs `DATABASE_URL` and the same OpenShop/Shopify configuration. Run at least one worker; the web process queues runs but does not execute them.
