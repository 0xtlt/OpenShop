---
title: Getting Started
description: Create and run a new OpenShop app.
---

Create a new app:

```bash
pnpm dlx openshop init my-app
cd my-app
pnpm install
pnpm run shopify
```

The generated project includes:

```txt
openshop.config.ts
openshop.app.ts
flows/
providers/
proxy/
models/
shopify.app.toml
shopify.web.toml
drizzle.config.ts
drizzle/
```

## Development server

Use the standalone OpenShop dev server:

```bash
pnpm run dev
```

Use Shopify CLI for embedded app development:

```bash
pnpm run shopify
```

## Required services

OpenShop uses PostgreSQL. The repository template expects:

```bash
DATABASE_URL=postgresql://openshop:openshop@localhost:5432/openshop
```

`openshop init` generates the first migration in `./drizzle` from the OpenShop framework schema. In local development, `openshop dev` can push the schema with `drizzle-kit push --force`. In production, use versioned migrations:

```bash
pnpm exec openshop migrate generate
pnpm exec openshop migrate
```
