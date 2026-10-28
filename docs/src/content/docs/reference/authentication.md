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

## Embedded installation

Shopify managed installation installs the app from Shopify, without OAuth,
then opens it in the admin with a session token in the `id_token` query
parameter. When a signed launch reaches a shop that has no token for the app
that signed it, OpenShop verifies that `id_token` for the same app (signature,
audience, time claims, and a `dest` equal to the launch's `shop`) and
exchanges it for an offline token. The app renders at once, in single-app and
multi-app mode alike, and later launches use the stored token. Shopify is
asked for five seconds at most, and a redirect is never followed.

When the launch has no `id_token`, the token is not valid for that app and
shop, or Shopify refuses the exchange, the
[client credentials grant](#on-requests-signed-by-shopify) is tried, then the
launch redirects to OAuth. The redirect always names the app that signed the
launch, `default` included:

```text
/auth?shop=example.myshopify.com&app=default
```

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
for example one used by automated tests. A merchant's store of another
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
(no row, no token, or uninstalled), OpenShop may try the grant for that shop in
two cases only:

- an embedded admin load whose query HMAC is valid for one of the configured
  apps, once the [token exchange](#embedded-installation) of its `id_token`, if
  it has one, failed; the `shop` parameter must itself be exactly `<name>.myshopify.com`, and
  the signed `timestamp` must be within 90 seconds of the server's clock, in
  either direction (90 seconds included), the tolerance Shopify's own app
  library uses. A copied launch URL
  replayed later is still accepted as before, but never grants and never marks
  an uninstalled shop installed again: it redirects to `/auth`;
- an `/api` request whose session token is verified; the shop is its `dest`
  claim. Token exchange runs first, exactly as before the grant existed: its
  offline token does not expire, and a merchant's store sends no other
  request. The grant is only tried when token exchange fails.

On success the token is stored, an uninstalled row is marked installed again
(Shopify just showed the app open on that shop), and the request continues: the
app renders without the `/auth` redirect, which Shopify refuses to display
inside the admin frame. On any failure the request continues exactly as before
the grant existed: the admin load redirects to `/auth`, and an `/api` request
goes on without a stored token. A granted token that cannot be stored is logged
with a generic message naming the shop, never the token.

The request to Shopify is abandoned after five seconds, and a redirect is
never followed: it would send the client secret to another address. Failures
are remembered in process memory per app, shop and credentials (a truncated
SHA-256 digest of the client ID and secret, never the secret itself, so a
refusal of a wrong secret does not hold back the corrected one). During that
time the usual path is taken at once, without asking Shopify:

- a definite refusal, a `4xx` answer carrying a Shopify error code such as
  `shop_not_permitted` or `invalid_client`, for one hour, so a merchant's store
  pays one extra round trip to Shopify at most once an hour per process;
- a transient failure, a timeout, a network error, a redirect, a `429`, a
  `5xx`, a `4xx` without an error code, or an answer without a token, for 30
  seconds.

A failure is remembered for the kind of attempt that met it. A failure of
background work (below) never holds back a signed request: a cron refused
before the app was installed on the store does not keep the developer who
installs and opens it from getting a token. A failure of a signed request holds
back signed requests and background work alike. A successful grant of either
kind clears both. Nothing about failures is stored in the database.

Unsigned input never starts a grant for a shop of its choosing. `/auth`, public
routes, and MCP requests are not signed by Shopify; app proxy requests are
signed (HMAC) but never start a grant. A webhook's
signature covers the body, not the `X-Shopify-Shop-Domain` header, so the
header does not vouch for the shop: the webhook route answers `400` when it is
`__global__`, so that a webhook can never name the placeholder of background
work. A webhook handler that uses a Shopify client is background work like any
other: it can reach the configured shop below, and the `401` renewal of a token
already stored for its shop (one grant, one retry), never a grant for a shop
without a row.

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
  so a shop marked uninstalled stays out. A cron that names its shops, as a
  string or a list, runs for each named shop whether or not it has a row, as it
  always did; for the configured shop, the client then requests its token, and
  refuses one when the row says the shop was uninstalled;
- background work never revives an uninstalled shop: it does not grant for a
  row marked uninstalled and never clears `uninstalled_at`. Only a signed
  request from Shopify does.

The value must be exactly `<name>.myshopify.com`. In multi-app mode the
`default` handle's credentials are used, and a config without a `default`
handle is refused. The web server, the scheduler, and the worker refuse to
start when the value is malformed or the `default` app has no API key and
secret. Elsewhere, for example a script that only calls `createShopifyClient`,
a malformed value is ignored with one warning: no shop is granted by it, and
every other shop works as before.

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
- Concurrent callers in one process share one grant request per app, shop and
  credentials, whether a signed request or background work started it. Each
  stores the answer on its own terms: background work still never marks an
  uninstalled shop installed again. A failure of a shared request is
  remembered for the kind of caller that started it.
- An MCP call or a flow run that is cancelled stops waiting for the grant at
  once, and sends nothing when it was already cancelled; the shared request
  still ends by itself for the other callers.
- Neither the Admin API requests, the grant, token exchange nor the OAuth
  callback follow a redirect, so a token or secret never reaches another
  address. A redirect fails with `[openshop] Shopify answered a redirect, not
  followed`, and the OAuth callback answers `502` with that message.
- The grant reads the app's client ID and secret from the config of the code
  that asks: flows, crons, admin pages, API handlers and MCP each pass their
  own, so two servers in one process never share credentials. The public
  `createShopifyClient` takes no config, so it only has the `default` app's
  credentials, from `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`; in multi-app
  mode, run Shopify work that may need a grant in a flow.

The MCP `openshop.admin.graphql` tool resolves its token the same way, for a
shop installed for the app only: it uses the stored token of the requested shop
unless its row is marked uninstalled (or, for the configured shop, a granted
one), renews it once after a `401`, and returns the original `401` response when
that fails. Its `shop` argument comes from the caller, not from Shopify, so it
never grants for any other shop without a stored token. `openshop.shops.list`
agrees with it: it lists the shops with a token and not marked uninstalled, and
the configured shop unless its row is marked uninstalled.

Shops whose grant is refused keep exactly the behaviour they had before: OAuth,
token exchange, and their stored tokens. The token has the scopes of the app's
released version. Errors and logs name the HTTP status and Shopify's error code;
the client ID, secret, and token are never logged, and a token that cannot be
stored is reported without the database query or its parameters.

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
| Manual OAuth start | `?app=<handle>`; optional when exactly one app exists. The launch fallback always sets it |
| Signed admin launch or OAuth callback | Query HMAC matches exactly one app secret |
| App proxy | Query signature matches exactly one app secret |
| Webhook | Raw-body HMAC matches exactly one app secret |
| App Bridge or Customer Account JWT | Audience matches exactly one API key, then signature verification |

Zero or ambiguous matches fail authentication. Configured API keys must be
unique, and each app should use its own secret. See
[Configure Shopify apps](/guides/configure-shopify-apps/) for setup and
[Shop and app isolation](/concepts/shop-isolation/) for the data boundary.
