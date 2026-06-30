---
title: Database and migrations
description: PostgreSQL, Drizzle models, and OpenShop migration commands.
---

OpenShop uses PostgreSQL and Drizzle.

## App models

Use `defineModel()` for app tables with common columns:

```ts
import { defineModel, integer, text } from 'openshop/schema'

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

OpenShop projects own their Drizzle migrations in `./drizzle`. The initial migration is generated when you run `openshop init`; it includes framework-owned tables such as installations, flow runs, step results, logs, provider configs, and cron overrides.

Generate migrations in development or CI:

```bash
pnpm exec openshop migrate generate
```

Check migration history:

```bash
pnpm exec openshop migrate check
```

Apply committed migrations:

```bash
pnpm exec openshop migrate
```

## Production constraints

`openshop migrate` only applies SQL from `./drizzle`; it does not load `drizzle.config.ts` or run generation tooling.

`openshop start` and `openshop worker` never generate or apply migrations. Apply migrations before starting production processes.
