---
title: Authentication
description: Authentication used by the embedded admin, OAuth, webhooks, proxy routes, Customer Account extensions, and MCP.
---

OpenShop uses a different authentication mechanism for each surface. Do not
forward one surface's credential to another.

| Surface | Credential | Verification | Trusted identity |
| --- | --- | --- | --- |
| Embedded admin and `/api/*` | Shopify session token in `Authorization: Bearer …` | HMAC JWT signature, audience, time claims, and destination | `shop`, `shopifyApp`, staff user subject (`sub`) |
| OAuth start `/auth` | Shop domain and optional configured app handle | Shop normalization and configured app lookup | requested shop and app |
| OAuth callback | Signed Shopify query plus OAuth `state` | Shopify HMAC and stored nonce | verified shop and app |
| `/webhooks/*` | `X-Shopify-Hmac-Sha256` | HMAC over the raw request body | shop and app selected by the matching secret |
| `/proxy/*` | Shopify App Proxy query signature, or Customer Account JWT | Query HMAC or JWT | shop, app, optional customer |
| `/ext/*` | Customer Account session JWT | JWT signature and audience | shop, app, customer |
| `/routes/*` | Route-defined | Explicit `auth` function, or intentionally public with `auth: 'none'` | Route-defined; optional `forShop()` context |
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

## Client credentials (development stores)

Shopify's [client credentials grant](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant)
issues an Admin API token without a browser, but only when the app and the
store belong to the **same Shopify organization**. It never works on a
merchant's store, so it is off by default and meant for development stores
that an organization owns and keeps the app installed on, for example stores
used by automated tests or agents.

Enable it for one store in single-app mode:

```dotenv
SHOPIFY_API_KEY=your-client-id
SHOPIFY_API_SECRET=your-client-secret
SHOPIFY_CLIENT_CREDENTIALS_SHOP=your-dev-store.myshopify.com
```

The value must be a `*.myshopify.com` domain; otherwise the web server refuses
to start and Shopify clients fail. With the variable set, for the `default` app and that shop only:

- When no token is stored, OpenShop requests one from
  `https://<shop>/admin/oauth/access_token` with
  `grant_type=client_credentials` and the app's client ID and secret, then
  stores it in `installations` like an OAuth token, encrypted when
  `ENCRYPTION_KEY` is configured. An empty database needs no installation step.
- A stored token is reused until five minutes before its 24-hour lifetime ends,
  then renewed. A `401` from the Admin API renews it once and retries the
  request once. Concurrent requests in one process share a single renewal.
- Flows and crons that run on the synthetic `__global__` shop get a Shopify
  client for the configured shop. Their runs, cron overrides, and provider
  configurations stay under `__global__`. A cron with `shops: 'all'` also
  targets the configured shop before it has an installation row.
- Opening the embedded app in Shopify admin from a production build obtains
  the token instead of redirecting to `/auth`, which Shopify refuses to display
  inside the admin frame. A refused grant shows an error page there.

Other shops and other app handles keep OAuth and token exchange. The token has
the scopes of the app's released version. A refusal, such as
`shop_not_permitted` when the store belongs to another organization or the app
is not installed on it, fails the call with the HTTP status and Shopify's error
code; the client ID, secret, and token are never logged.

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

## App selection

| Request | App resolution |
| --- | --- |
| Manual OAuth start | `?app=<handle>`; optional when exactly one app exists |
| Signed admin launch or OAuth callback | Query HMAC matches exactly one app secret |
| App proxy | Query signature matches exactly one app secret |
| Webhook | Raw-body HMAC matches exactly one app secret |
| App Bridge or Customer Account JWT | Audience matches exactly one API key, then signature verification |

Zero or ambiguous matches fail authentication. Configured API keys must be
unique, and each app should use its own secret. See
[Configure Shopify apps](/guides/configure-shopify-apps/) for setup and
[Shop and app isolation](/concepts/shop-isolation/) for the data boundary.
