---
title: Production
description: Build, migrate, and run OpenShop in production.
---

Build the app:

```bash
pnpm run build
```

This generates:

```txt
dist/ui
dist/openshop/server
```

## Required environment

Single-app deployments can keep using the legacy environment variables:

```bash
DATABASE_URL=postgresql://...
SHOPIFY_API_KEY=...
SHOPIFY_API_SECRET=...
HOST=https://your-app.example.com
ENCRYPTION_KEY=<64 hex characters>
```

Generate an encryption key:

```bash
openssl rand -hex 32
```

`ENCRYPTION_KEY` protects provider credentials and Shopify access tokens.

Multi-app deployments should use explicit per-app credentials in `openshop.config.ts`, usually backed by environment variables:

```bash
DATABASE_URL=postgresql://...
HOST=https://your-app.example.com
ENCRYPTION_KEY=<64 hex characters>

SHOPIFY_CLIENT_A_API_SECRET=...
SHOPIFY_CLIENT_B_API_SECRET=...

# Only needed for non-TOML apps:
SHOPIFY_CLIENT_A_API_KEY=...
SHOPIFY_CLIENT_B_API_KEY=...
```

## Processes

Run web and worker separately:

```bash
pnpm exec openshop start
pnpm exec openshop worker --concurrency=5
```

`openshop start` serves HTTP traffic and dispatches cron runs. It does not execute queued flow runs. At least one worker must be running for queued runs to complete.

## Migrations

OpenShop applies framework migrations on boot. Your app-specific migrations must run before web and worker processes start.

## Shopify TOML deploys

OpenShop can read several Shopify TOML files from `shopify.apps`, for example `shopify.app.client-a.toml` and `shopify.app.client-b.toml`. Shopify does not apply production TOML changes just because the OpenShop server was deployed.

Deploy each Shopify app configuration with Shopify CLI:

```bash
shopify app deploy --config shopify.app.client-a.toml
shopify app deploy --config shopify.app.client-b.toml
```

Run these deploys whenever client IDs, URLs, scopes, access settings, webhooks, app proxy settings, or extensions change in a TOML file. Shopify's app configuration docs state that TOML changes are local configuration and production stores see them only after the deploy command runs.

This is the same operational model Gadget moved toward in framework v1.7: Shopify app configuration lives in TOML and must be deployed to Shopify through Shopify CLI.
