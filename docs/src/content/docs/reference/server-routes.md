---
title: Public server routes
description: Expose HTTP endpoints with explicit authentication and optional shop-scoped provider connectors.
---

Files under `routes/` are mounted under `/routes/*`. They use Web standard
`Request` and `Response` objects and do not require Shopify authentication.

```ts
// routes/ping.ts
import { app } from '#app'

export default app.defineRoute({
  auth: 'none',
  GET: () => Response.json({ ok: true }),
})
```

The endpoint is available at `GET /routes/ping`. Use `auth: 'none'` only when
the endpoint is intentionally unauthenticated.

## File routing

| File | Endpoint |
| --- | --- |
| `routes/index.ts` | `/routes` |
| `routes/callback.ts` | `/routes/callback` |
| `routes/orders/[id].ts` | `/routes/orders/:id` |

Files and directories whose names begin with `_` are ignored. Supported method
keys are `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, and `OPTIONS`. A request
using another method receives `405 Method Not Allowed` with an `Allow` header.

## Authentication

Every route must set `auth` to either `'none'` or a function. Omitting it makes
server startup fail. The function receives a cloned `Request`, so both it and
the handler may read the body.

- Return `null` to produce `401 Unauthorized`.
- Return a `Response` to stop with a custom response.
- Return any other value to expose it as `ctx.auth` in the handler.

Thrown authentication or handler errors are logged and return a generic `500`
response. Handlers must always return a `Response`. OpenShop does not add CORS
headers or parse request bodies for public routes.

## Shop-scoped connectors

Authentication functions and handlers receive `forShop({ shop, shopifyApp? })`.
It resolves an active Shopify installation and returns the normalized `shop`,
resolved `shopifyApp`, and typed provider `connectors` for that tenant. Provider
configuration remains encrypted at rest and is never included in the returned
context.

Values used to select a shop are untrusted until the route authenticates the
request. Never treat a query parameter, path parameter, header, or decoded but
unverified payload as proof of identity.
