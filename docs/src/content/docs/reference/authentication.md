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
store belong to the **same Shopify organization** and the app is installed on
the store. It suits a development store of the organization that owns the app,
exercised by automated tests or a coding agent. A merchant's store of another
organization is always refused (for example with `shop_not_permitted`).

OpenShop requests the token from `https://<shop>/admin/oauth/access_token`
with `grant_type=client_credentials` and the app's own client ID and secret
(from `shopify.apps` in multi-app mode, from `SHOPIFY_API_KEY` /
`SHOPIFY_API_SECRET` in single-app mode). A granted token is stored in
`installations` like an OAuth token, encrypted when `ENCRYPTION_KEY` is
configured. The shop is used only when it is exactly `<name>.myshopify.com`
(lowercase, no scheme, port, path or credentials), and both the token endpoint
and the Admin API address are built from that value.

### On requests signed by Shopify

No variable is needed. When the resolved app has no usable token for the shop
(no row, no token, or uninstalled), OpenShop tries the grant for that shop in
two cases only:

- an embedded admin load whose query HMAC is valid for one of the configured
  apps; the `shop` parameter must itself be exactly `<name>.myshopify.com`;
- an `/api` request whose session token is verified; the shop is its `dest`
  claim.

On success the token is stored, an uninstalled row is marked installed again
(Shopify just showed the app open on that shop), and the request continues: the
app renders without the `/auth` redirect, which Shopify refuses to display
inside the admin frame. On any failure the request continues exactly as before
the grant existed: the admin load redirects to `/auth`, and an `/api` request
uses token exchange.

A refusal (any non-2xx answer or network error) is remembered in process memory
for one hour per app and shop. During that hour no grant is attempted for that
pair and the usual path is taken at once, so a merchant's store pays one extra
round trip to Shopify at most once an hour per process. A successful grant
clears the entry. Nothing about refusals is stored in the database.

Webhooks never trigger a grant: Shopify's webhook signature covers the body,
not the `X-Shopify-Shop-Domain` header, so it does not vouch for the shop.
`/auth`, public routes, proxy routes, and MCP requests are not signed by
Shopify either and never start a grant for a shop of their choosing.

### Background work: `SHOPIFY_CLIENT_CREDENTIALS_SHOP`

Crons, flows on the synthetic `__global__` shop, and other work with no incoming
request cannot learn a shop from Shopify, in particular after the database was
emptied. The optional variable names one development store for them:

```dotenv
SHOPIFY_CLIENT_CREDENTIALS_SHOP=your-dev-store.myshopify.com
```

With it set, for the `default` app:

- a Shopify client for that shop or for `__global__` requests a token when none
  is stored. Runs, cron overrides, and provider configurations stay under
  `__global__`; only the Shopify client talks to the configured store;
- a cron with `shops: 'all'` also targets the configured shop when no
  installation row exists for it at all. A row of any kind is left to decide,
  so a shop marked uninstalled stays out;
- background work never revives an uninstalled shop: it does not grant for a
  row marked uninstalled and never clears `uninstalled_at`. Only a signed
  request from Shopify does.

The value must be exactly `<name>.myshopify.com`. In multi-app mode the
`default` handle's credentials are used, and a config without a `default`
handle is refused. The web server, the scheduler, and the worker refuse to
start when the value is malformed or the `default` app has no API key and
secret.

### Stored tokens and renewal

- A stored token, whether it came from OAuth, token exchange, or a grant, is
  used as is. OpenShop never replaces a working token.
- A token this process obtained by grant is renewed five minutes before the
  `expires_in` Shopify returned with it. That lifetime is kept in memory only,
  so a token stored by another process or before a restart is used until the
  Admin API rejects it.
- When the Admin API answers `401`, OpenShop requests one grant with the app's
  credentials and retries the request once, never more. When the shop is
  marked uninstalled or the grant fails, the original `401` error is returned.
- Concurrent callers in one process share one grant request per app and shop.

The MCP `openshop.admin.graphql` tool resolves its token the same way: it uses
the stored token of the requested shop (or, for the configured shop, a granted
one), renews it once after a `401`, and returns the original `401` response when
that fails. Its `shop` argument comes from the caller, not from Shopify, so it
never grants for any other shop without a stored token.

Shops whose grant is refused keep exactly the behaviour they had before: OAuth,
token exchange, and their stored tokens. The token has the scopes of the app's
released version. Errors and logs name the HTTP status and Shopify's error code;
the client ID, secret, and token are never logged.

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
