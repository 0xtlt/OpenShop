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

Files and directories prefixed with `_` are private and do not create routes:

```txt
proxy/garage/_service.ts       -> ignored
proxy/garage/_queries.ts       -> ignored
proxy/garage/_shared/index.ts  -> ignored
```

Use private files for route-local helpers when colocating code keeps the route easier to maintain.

## Shared route code

Keep proxy route files thin. They should adapt HTTP concerns such as method handling, auth checks, route params, body parsing, and response shape. Put reusable business logic in server-side modules:

```txt
proxy/garage/index.ts              # route adapter
proxy/garage/vehicles/[id].ts      # route adapter
proxy/garage/_shared.ts            # route-local helper, not a route
server/garage.ts                   # shared server logic
queries/garage.ts                  # shared Admin GraphQL operations
lib/server/garage.ts               # app server utilities
```

If shared logic calls the Shopify Admin API, pass `ctx.shop` and `ctx.shopifyApp` through and create the client with `createShopifyClient(ctx.shop, ctx.shopifyApp)`.

## Authentication

OpenShop supports:

- Shopify app proxy HMAC signatures;
- Customer Account session JWTs for extension-direct routes.

The `ProxyContext` exposes the trusted `shop`, optional `customerId`, route params, query, headers, path, method, and parsed body.
