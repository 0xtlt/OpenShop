---
title: Proxy Routes
description: Define file-based app proxy and extension-direct routes.
---

Proxy routes live in the `proxy/` directory and export `app.defineProxy()`.

```ts
import { app } from '../openshop.app'

export default app.defineProxy({
  type: 'json',
  async GET({ shop, customerId, query }) {
    return { shop, customerId, query }
  },
  async POST({ body }) {
    return { ok: true, body }
  },
})
```

## Routing

Files map to routes:

```txt
proxy/reviews.ts        -> /proxy/reviews
proxy/api/reviews.ts    -> /proxy/api/reviews
proxy/products/[id].ts  -> /proxy/products/:id
```

## Authentication

OpenShop supports:

- Shopify app proxy HMAC signatures;
- Customer Account session JWTs for extension-direct routes.

The `ProxyContext` exposes the trusted `shop`, optional `customerId`, route params, query, headers, path, method, and parsed body.
