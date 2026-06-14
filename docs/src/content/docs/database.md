---
title: Database & Migrations
description: Use Drizzle models and migrations with OpenShop.
---

OpenShop uses PostgreSQL and Drizzle.

## App models

Use `defineModel()` for app tables with common columns:

```ts
import { defineModel, text, integer } from 'openshop/schema'

export const reviews = defineModel('reviews', {
  title: text('title').notNull(),
  rating: integer('rating').notNull(),
})
```

By default, models include:

- `id`
- `shop`
- `createdAt`
- `updatedAt`

## Client-owned migrations

OpenShop projects own their Drizzle migrations in `./drizzle`. The initial migration is generated when you run `openshop init`; it includes framework-owned tables:

- installations
- flow runs
- step results
- logs
- provider configs
- cron overrides

The same migration folder also owns app model tables created with `defineModel()`.

Generate a new migration after changing framework version or app models. This is a development or CI command and requires Drizzle Kit:

```bash
pnpm exec openshop migrate generate
```

Check the generated migration history in development or CI:

```bash
pnpm exec openshop migrate check
```

Apply already committed migrations manually before starting production web and worker processes:

```bash
pnpm exec openshop migrate
```

For local development, `openshop dev` can use schema push. Production should use generated, reviewed, committed migrations. `openshop migrate` only applies SQL from `./drizzle`; it does not load `drizzle.config.ts` or run generation tooling. `openshop start` and `openshop worker` never generate or apply migrations.
