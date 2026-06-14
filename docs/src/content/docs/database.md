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

## Framework migrations

OpenShop framework migrations manage framework-owned tables:

- installations
- flow runs
- step results
- logs
- provider configs
- cron overrides

## Project migrations

Your app tables are managed by your project migrations. Run them before starting production web and worker processes.

```bash
pnpm exec openshop migrate project
```

For local development, `openshop dev` can use schema push. Production should use versioned migrations.
