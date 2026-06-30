---
title: Proxy routes
description: File-based proxy route behavior and ProxyContext fields.
---

Proxy routes live in the `proxy/` directory and export `app.defineProxy()`.

```ts
export default app.defineProxy({
  type: 'json',
  async GET({ shop, customerId, query }) {
    return { shop, customerId, query }
  },
})
```

## Response types

| Type | Use |
| --- | --- |
| `json` | JSON API responses. |
| `html` | HTML responses. |
| `liquid` | Shopify app proxy Liquid responses. |

## Context

| Field | Purpose |
| --- | --- |
| `shop` | Trusted shop domain. |
| `shopifyApp` | Internal app handle that authenticated the request. |
| `customerId` | Trusted customer ID or `null`. |
| `auth` | Auth source: app proxy HMAC or Customer Account JWT. |
| `query` | Query parameters. |
| `params` | Route parameters. |
| `headers` | Request headers. |
| `path` | Request path. |
| `method` | HTTP method. |
| `body` | Parsed request body. |

## Authentication

OpenShop supports Shopify app proxy HMAC signatures and Customer Account session JWTs for extension-direct routes.

Trust `ctx.shop`, `ctx.shopifyApp`, and `ctx.customerId` from OpenShop. Do not trust shop or customer identity from client-provided query parameters.
