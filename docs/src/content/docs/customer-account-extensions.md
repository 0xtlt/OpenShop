---
title: Customer Account Extensions
description: Call OpenShop proxy routes from Customer Account UI extensions.
---

Customer Account UI extensions can call OpenShop proxy routes through the `/ext` mount using a Shopify session token.

OpenShop mounts the same `proxy/` handlers in two places:

- `/proxy/*` accepts Shopify app proxy HMAC requests.
- `/ext/*` accepts Customer Account session JWT requests with `Authorization: Bearer <token>`.

## Extension request

Enable network access in the extension TOML:

```toml
[extensions.capabilities]
network_access = true
```

From the extension, read a session token and send it as a Bearer token:

```ts
const token = await shopify.sessionToken.get()

const response = await fetch(`${apiOrigin}/ext/garage`, {
  headers: {
    Authorization: `Bearer ${token}`,
  },
})

const data = await response.json()
```

In Shopify CLI development, `shopify.extension.scriptUrl` can be used to derive the tunnel origin. In production, use the deployed app origin or extension settings for the backend URL.

## Proxy route

Define the backend route in `proxy/`:

```ts
import { app } from '../openshop.app.ts'

export default app.defineProxy({
  type: 'json',
  async GET({ shop, shopifyApp, customerId }) {
    if (!customerId) {
      return { ok: false, error: 'Customer authentication required' }
    }

    return { ok: true, shop, shopifyApp, customerId }
  },
})
```

For Customer Account session JWTs, OpenShop verifies the token against the resolved Shopify app secret, sets `ctx.shop` from the token destination, and sets `ctx.customerId` from the token subject when available.

## Shopify Admin GraphQL

Use `createShopifyClient(ctx.shop, ctx.shopifyApp)` inside extension-backed proxy routes so multi-app installations resolve the correct token:

```ts
import { createShopifyClient } from 'openshop'

if (!ctx.customerId) {
  return { ok: false, error: 'Customer authentication required' }
}

const shopify = await createShopifyClient(ctx.shop, ctx.shopifyApp)
const data = await shopify.graphql(customerGarageQuery, {
  variables: { id: customerGid(ctx.customerId) },
})
```

If the GraphQL operation is shared from another file, define it with `graphqlOperation()` from `openshop/graphql` so `shopify.graphql()` keeps generated variables and return types.

## Security

- Trust `ctx.shop`, `ctx.shopifyApp`, and `ctx.customerId` from OpenShop, not query-string customer identifiers.
- Treat `customerId` as optional; customers can be unauthenticated or lack the required access.
- Keep extension-facing responses small and avoid returning secrets or raw Admin API payloads.
- Add only the Shopify scopes needed by the extension flow.
