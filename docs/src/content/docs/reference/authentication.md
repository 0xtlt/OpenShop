---
title: Authentication
description: Authentication used by the embedded admin, OAuth, webhooks, proxy routes, Customer Account extensions, and MCP.
---

OpenShop uses a different authentication mechanism for each surface. Do not
forward one surface's credential to another.

| Surface | Credential | Verification | Trusted identity |
| --- | --- | --- | --- |
| Embedded admin and `/api/*` | Shopify session token in `Authorization: Bearer …` | HMAC JWT signature, audience, time claims, and destination | `shop`, `shopifyApp`, customer `sub` |
| OAuth start `/auth` | Shop domain and optional configured app handle | Shop normalization and configured app lookup | requested shop and app |
| OAuth callback | Signed Shopify query plus OAuth `state` | Shopify HMAC and stored nonce | verified shop and app |
| `/webhooks/*` | `X-Shopify-Hmac-Sha256` | HMAC over the raw request body | shop and app selected by the matching secret |
| `/proxy/*` | Shopify App Proxy query signature, or Customer Account JWT | Query HMAC or JWT | shop, app, optional customer |
| `/ext/*` | Customer Account session JWT | JWT signature and audience | shop, app, customer |
| `/mcp` | OpenShop token in `Authorization: Bearer …` | Stored token hash, status, expiry, shop, and permissions | token, shop, app, grants |

## Embedded admin API

Send the Shopify session token exactly as a bearer token:

```http
Authorization: Bearer <shopify-session-token>
```

OpenShop rejects missing, invalid, expired, or wrong-audience tokens with
`401`. API handlers read the verified shop and app identity from middleware;
client-supplied `shop` query parameters do not replace that identity.

## OAuth installation

Single-app mode starts installation at:

```text
/auth?shop=example.myshopify.com
```

Multi-app mode also requires the configured handle:

```text
/auth?shop=example.myshopify.com&app=clientA
```

The callback validates the HMAC and one-time state before storing the access
token. Access tokens are encrypted when `ENCRYPTION_KEY` is configured.

## Webhook and proxy bodies

Webhook HMAC validation uses the raw body. Reverse proxies and middleware must
not rewrite it before OpenShop receives the request. App Proxy signatures cover
the signed query parameters. In proxy handlers, trust `ctx.shop`,
`ctx.shopifyApp`, and `ctx.customerId`; do not replace them with values from
`ctx.query`.

## Browser origins

OpenShop allows known Shopify origins, configured app origins, local development
origins, and `https://extensions.shopifycdn.com`. Arbitrary origins are not
reflected in CORS responses.

See [Security](/reference/security/) for secret handling and deployment
requirements.
