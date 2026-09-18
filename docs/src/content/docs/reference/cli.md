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

## Scaffold a project

```bash
pnpm dlx openshop init my-app
```

`init <dir>` requires an empty or nonexistent target directory. It copies the
bundled minimal template, pins the generating package version, and generates the
initial migration. It does not update an existing app. See the
[first-app tutorial](/tutorials/first-app/) for the full setup.

## Command behavior

Run commands from the app root unless scaffolding a new project.

| Command | Input or flags | Behavior |
| --- | --- | --- |
| `dev` | Process environment and `.env` | Codegen, development schema push, API, UI, worker, scheduler, and reloads |
| `build` | Process environment | Creates `dist/ui` and `dist/openshop/server` |
| `start` | Process environment | Serves the built app and starts cron dispatch; no worker or migrations |
| `worker` | `--concurrency=N` | Executes queued runs from the built config; the current CLI defaults the flag to `5` |
| `migrate` | Committed `drizzle/` directory | Applies SQL; does not run generation tooling |
| `migrate generate` | Extra arguments forwarded to Drizzle Kit, such as `--name=add-reviews` | Generates app-owned migration files; blocked in production by default |
| `migrate check` | Project Drizzle config and migrations | Checks history and detects schema changes not covered by committed migrations |
| `migrate status` | Database and committed migrations | Prints applied and pending migration counts |
| `codegen` | App GraphQL config | Generates operation types once |
| `codegen:watch` | App GraphQL config | Regenerates types when documents change |
| `test` | Remaining arguments forwarded to `tests/bootstrap.ts` | Attempts a development schema push, then runs the app-owned bootstrap |

The built server is required by both `start` and `worker`. Neither command
builds or migrates the application automatically. See
[Deploy to production](/guides/deploy-production/) for the sequence.

## Development process

`pnpm run shopify` executes Shopify CLI, which invokes the OpenShop development
command from the generated web configuration. Do not start a second `pnpm run dev`
process alongside it.

Only `dev` loads the project-root `.env` file. Set variables explicitly for build,
migration, test, and production commands. Existing process variables take
precedence over `.env` in development. See
[Environment variables](/reference/environment-variables/).

## Test bootstrap

The generated project includes the `test` package script but no test suite.
`openshop test` exits with an error if `tests/bootstrap.ts` is missing. The
bootstrap owns test discovery, runner choice, and any suite arguments; the CLI
does not implement a fixed list of test suites. Follow [Test an app](/guides/test-app/)
to add one.
