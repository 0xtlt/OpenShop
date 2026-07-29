---
title: Proxy routes
description: File routing, methods, authentication, responses, CORS, and errors.
---

Proxy routes live in `proxy/` and default-export `app.defineProxy()`.

```ts
export default app.defineProxy({
  type: 'json',
  async GET({ shop, customerId, query }) {
    return { shop, customerId, query }
  },
})
```

## File routing

| File | Mounted paths |
| --- | --- |
| `proxy/index.ts` | `/proxy` and `/ext` |
| `proxy/reviews.ts` | `/proxy/reviews` and `/ext/reviews` |
| `proxy/products/[id].ts` | `/proxy/products/:id` and `/ext/products/:id` |

`.ts` and `.js` files are loaded. Any file or directory whose name begins with
`_` is ignored. A module import failure is logged and that route is skipped.

## Methods and request body

Definitions support `GET`, `POST`, `PUT`, `DELETE`, and `PATCH`. Only declared
handlers are registered.

For non-GET methods, OpenShop reads the body as text and attempts `JSON.parse()`.
An empty or invalid JSON body becomes `undefined`; it is not an automatic 400.
GET bodies are not read.

## Response types

| `type` | Successful handler result | Content-Type |
| --- | --- | --- |
| `json` or omitted | `JSON.stringify(result)` | `application/json` |
| `html` | String | `text/html` |
| `liquid` | String | `application/liquid` |

`html` or `liquid` falls back to JSON when the returned value is not a string.
Handlers return values, not a status/headers response object; the current API
always sends successful handler results with HTTP 200.

## Context

| Field | Source |
| --- | --- |
| `shop` | Verified `shop` query parameter or JWT `dest`. |
| `shopifyApp` | App whose secret or API key authenticated the request. |
| `customerId` | Numeric signed `logged_in_customer_id`, customer JWT subject, or `null`. |
| `auth.kind` | `'appProxyHmac'` or `'customerAccountJwt'`. |
| `query` | Query strings, with trusted shop/customer values substituted. |
| `params` | Dynamic file-route parameters. |
| `headers` | Lower-cased request headers. |
| `path`, `method` | Request pathname and method. |
| `body` | Parsed JSON for non-GET requests, otherwise `undefined`. |

## Authentication mounts

`/proxy/*` accepts either:

- a Shopify app proxy signature matched against exactly one configured app; or
- a Customer Account session JWT whose audience matches a configured API key.

`/ext/*` accepts only the Customer Account JWT. It exists so extensions can call
the app origin directly without Shopify CLI intercepting `/proxy`.

The app proxy customer ID is trusted only when it is numeric. For JWTs,
OpenShop's customer-subject parser rejects non-customer subjects, including
numeric Shopify admin subjects.

## Shopify app proxy configuration

OpenShop does not add app proxy settings to Shopify. Configure the external
Shopify route in the app TOML, then deploy that configuration with Shopify CLI.
The exact TOML fields and public storefront URL are owned by Shopify; point the
proxy destination at your OpenShop `/proxy/...` route.

## Customer Account extension and CORS

Enable network access in the extension's TOML:

```toml
[extensions.capabilities]
network_access = true
```

Send the session token as `Authorization: Bearer ...`. CORS allows local
origins, Shopify admin, Shopify storefront domains, Shopify's extension CDN,
and configured `HOST` / `SHOPIFY_APP_URL` origins. Other origins receive no
`Access-Control-Allow-Origin` header.

## Errors

| Status | Condition |
| --- | --- |
| `401` | Invalid proxy signature, bad/missing JWT, missing audience, or disallowed auth mode. |
| `500` | No Shopify secret is configured. |
| `500` | Handler throws; response is `{ "error": "Internal proxy error" }`. |

Authentication fails closed if zero or multiple configured apps match a
signature. Handler errors are logged without exposing their details.
