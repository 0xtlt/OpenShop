---
title: Manage migrations
description: Generate, review, commit, and apply app-owned Drizzle migrations before starting production processes.
---

Use this guide when adding app models or upgrading OpenShop's framework schema.
Start with a generated app, its `drizzle.config.ts`, and an explicitly configured
`DATABASE_URL` for each environment.

## 1. Include the schema

The generated Drizzle config includes the framework and app models:

```ts
import { defineConfig } from 'drizzle-kit'
import { frameworkSchemaPath } from 'openshop/drizzle'

export default defineConfig({
  dialect: 'postgresql',
  schema: [frameworkSchemaPath, './models/**/*.ts'],
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL! },
  migrations: { schema: 'drizzle', table: '__drizzle_migrations' },
})
```

Keep `frameworkSchemaPath` in that list. Put application models in `models/`, or
update the glob if you use another location. See the
[model reference](/reference/database/#app-models) for model definitions.

## 2. Generate and review locally

With development dependencies installed, run outside production mode:

```bash
pnpm run db:generate
pnpm run db:check
```

Review the new SQL and metadata under `drizzle/`, especially destructive changes
and required columns on existing tables. Commit those files with the code that
needs them. `db:check` checks migration history and schema coverage; it does not decide
whether a schema change is safe for your data.

`openshop dev` pushes the schema for local iteration. A successful dev session
is not proof that committed migrations can upgrade an existing database. Test
the migration sequence on a separate database with the previous schema.

## 3. Apply committed SQL during deployment

Inject the target environment's `DATABASE_URL` through your deployment platform,
then run the finite migration job once before starting the new app processes:

```bash
pnpm exec openshop migrate
pnpm exec openshop migrate status
```

Expect `pending: 0`. Migration commands do not load the development `.env` file;
export the URL explicitly when running them manually.

The apply command reads committed SQL from `drizzle/`; it does not load
`drizzle.config.ts` or generate new files. Include the migration directory in
the deployment artifact. Web and worker startup never apply migrations.

## 4. Verify and recover

Start the web and worker services and run a harmless smoke flow. If schema access
fails, check the migration job's database URL and status before restarting again.

Take a database backup before a production schema change. If SQL has already
been applied, an application rollback is safe only when the old code remains
compatible with that schema; use a reviewed forward migration or your database
restore procedure otherwise.

Continue with [Deploy to production](/guides/deploy-production/) or
[Upgrade OpenShop](/guides/upgrade/).
