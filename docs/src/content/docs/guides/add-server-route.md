---
title: Add a server route
description: Expose a service-to-service endpoint with explicit authentication and a standard HTTP response.
---

Use `routes/` for callers outside Shopify, such as a warehouse service. This
guide adds a token-protected status endpoint to an existing OpenShop app.
For storefront or Customer Account requests, use [proxy routes](/guides/add-proxy-routes/).

## 1. Configure a service token

Generate a random token with `openssl rand -hex 32`. Save it as
`INBOUND_API_TOKEN` in the app's local `.env` and in the calling service's secret
configuration. Restart development after changing the environment.
In production, inject it through your deployment platform. This is an
application-defined variable, not a built-in OpenShop option.

## 2. Create the endpoint

Create `routes/status.ts`:

```ts
import { timingSafeEqual } from 'node:crypto'
import { app } from '#app'

export default app.defineRoute({
  auth: ({ request }) => {
    const token = process.env.INBOUND_API_TOKEN
    if (!token) return null

    const expected = Buffer.from(`Bearer ${token}`)
    const supplied = Buffer.from(request.headers.get('authorization') ?? '')
    if (supplied.length !== expected.length) return null
    return timingSafeEqual(supplied, expected) ? { service: 'warehouse' } : null
  },
  GET: ({ auth }) => Response.json({ ok: true, service: auth.service }),
})
```

The route is discovered automatically at `GET /routes/status`; no config
registration is needed. Returning `null` from `auth` rejects the request with
401. The handler returns a standard `Response`, including any custom status or
headers you need.

## 3. Check both authentication paths

With development running on its default port, call it without credentials:

```bash
curl -i http://localhost:3000/routes/status
```

Expect **401**. In your calling terminal, set `INBOUND_API_TOKEN` to the same
value stored in the app, then call:

```bash
curl --fail http://localhost:3000/routes/status \
  -H "Authorization: Bearer $INBOUND_API_TOKEN"
```

Expect `{ "ok": true, "service": "warehouse" }`. Use the HTTPS app origin when
calling from a remote service. Run `pnpm run lint` before deploying.

## Add shop-specific work

This token identifies a service, not a Shopify shop. Before using `forShop()`,
map the authenticated caller to a shop it is authorized to access; a shop name
in a request is not proof of access. The [server route reference](/reference/server-routes/)
shows the context contract and how an authenticated route dispatches a flow.
