---
title: Configure Shopify apps
description: Configure one or multiple Shopify apps and understand resolution rules.
---

One OpenShop instance can serve one Shopify app or multiple apps.

## Single-app environment mode

Omit `shopify.apps` and set:

```bash
SHOPIFY_API_KEY=...
SHOPIFY_API_SECRET=...
HOST=https://your-app.example.com
```

`SHOPIFY_APP_URL` is the fallback when `HOST` is absent. Scopes come from
`shopify.scopes` or the first matching `shopify.app*.toml` file.
The internal app handle is `default`.

## Multi-app mode with TOML

```ts
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
        appUrl: 'https://openshop.example.com',
      },
    },
  },
  flows: {},
})
```

For each TOML app, OpenShop reads `client_id`, `application_url`, and
`access_scopes.scopes` using the corresponding keys in the file. `appUrl`
overrides the TOML application URL. `apiSecret` always comes from config and
should be environment-backed.

Missing TOML files and TOML files without `client_id` throw during app
resolution.

## Multi-app mode without TOML

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

Each app requires either `toml` or `apiKey`, never both, plus a non-empty
`apiSecret`. Handles may contain letters, numbers, `_`, and `-`.

## Scope rules

Apps in one instance must use identical OAuth scopes. Set `shopify.scopes` once
to make that explicit. Per-app `scopes` are rejected. When the global value is
omitted, TOML-derived non-empty scope strings must match exactly or resolution
throws.

Changing requested scopes may require Shopify OAuth approval or reinstallation;
OpenShop supplies the configured scope string to the authorization request but
does not grant scopes itself.

## How OpenShop selects an app

| Request | Resolution |
| --- | --- |
| Manual OAuth start | `?app=<handle>`; optional only when exactly one app exists. |
| Signed admin launch/callback | HMAC must match exactly one app secret. |
| App proxy | Proxy signature must match exactly one app secret. |
| Webhook | Raw-body HMAC must match exactly one app secret. |
| App Bridge / Customer Account JWT | JWT audience must match exactly one API key. |

Zero or multiple matches fail closed. API keys therefore need to be unique
within an instance, and secrets should not be shared between configured apps.

Start multi-app OAuth explicitly:

```txt
/auth?shop=shop.myshopify.com&app=clientA
```

## Deploy Shopify-side configuration

Deploying OpenShop does not apply TOML changes to Shopify:

```bash
shopify app deploy --config shopify.app.client-a.toml
shopify app deploy --config shopify.app.client-b.toml
```

Use Shopify CLI for callback URLs, webhook subscriptions, app proxy settings,
and extension/function deployment. Then verify OAuth separately for every app
handle and store.
