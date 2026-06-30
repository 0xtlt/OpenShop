---
title: Configure Shopify apps
description: Configure one or many Shopify apps for an OpenShop deployment.
---

OpenShop can serve one Shopify app or several apps from the same production instance.

## Single-app mode

For one Shopify app, omit `shopify.apps`. OpenShop reads the legacy Shopify credentials and TOML configuration when available:

```bash
SHOPIFY_API_KEY=...
SHOPIFY_API_SECRET=...
HOST=https://your-app.example.com
```

This is the simplest mode for a normal app project.

## Multi-app mode with TOML files

Use this mode when each Shopify app has its own `shopify.app*.toml` file. OpenShop reads the API key, application URL, and scopes from TOML. Keep API secrets in environment-backed config.

```ts
import { defineOpenShop } from 'openshop'

const app = defineOpenShop({ providers: {} })

export default app.defineConfig({
  shopify: {
    scopes: 'read_products,write_products',
    apps: {
      clientA: {
        toml: 'shopify.app.client-a.toml',
        apiSecret: process.env.SHOPIFY_CLIENT_A_API_SECRET!,
      },
      clientB: {
        toml: 'shopify.app.client-b.toml',
        apiSecret: process.env.SHOPIFY_CLIENT_B_API_SECRET!,
      },
    },
  },
  flows: {},
})
```

All apps in one OpenShop instance must use the same scopes. Prefer setting `shopify.scopes` once. If it is omitted, OpenShop reads scopes from TOML files and rejects mismatches.

## Multi-app mode without TOML files

Use this mode for deployments where Shopify app configuration is not stored locally:

```ts
export default app.defineConfig({
  shopify: {
    scopes: 'read_products,write_products',
    apps: {
      clientA: {
        apiKey: process.env.SHOPIFY_CLIENT_A_API_KEY!,
        apiSecret: process.env.SHOPIFY_CLIENT_A_API_SECRET!,
        appUrl: 'https://openshop.example.com',
      },
    },
  },
  flows: {},
})
```

## Verify it worked

Start OAuth manually with an explicit app handle when several apps are configured:

```txt
/auth?shop=shop.myshopify.com&app=clientA
```

Signed Shopify launches, OAuth callbacks, app proxy requests, webhooks, and App Bridge JWTs are resolved automatically from their HMAC or JWT audience.

## Deploy TOML changes

Shopify does not apply production TOML changes just because the OpenShop server was deployed. Deploy each Shopify app configuration with Shopify CLI:

```bash
shopify app deploy --config shopify.app.client-a.toml
shopify app deploy --config shopify.app.client-b.toml
```
