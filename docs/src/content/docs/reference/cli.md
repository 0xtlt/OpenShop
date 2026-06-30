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

## Production command order

Use this order in deploy pipelines:

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm exec openshop migrate
pnpm exec openshop start
pnpm exec openshop worker --concurrency=5
```
