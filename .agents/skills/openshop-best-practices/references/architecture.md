# Architecture

Use this reference before moving behavior across OpenShop boundaries.

## Repo Map

- `packages/openshop/src/engine`: flow execution, steps, scheduling, retries, aborts, and worker behavior.
- `packages/openshop/src/server`: Hono server, Shopify auth, webhooks, app proxy, admin API routes, functions, crypto, logs, and shop isolation.
- `packages/openshop/src/cli`: `openshop` commands for dev, start, worker, build, codegen, schema, init, and tests.
- `packages/openshop/src/db`: Drizzle client and schema helpers.
- `packages/openshop/src/vite`: Vite integration and GraphQL codegen bridge.
- `packages/openshop/src/ui`: embedded admin UI built with Preact and Shopify App Bridge web components.
- `packages/openshop/templates/minimal`: generated app template; update it when setup or conventions change.
- `apps/demo`: runnable demo app and integration surface; update it when examples or framework usage change.
- `docs/src/content/docs`: user-facing documentation.

## Boundary Rules

- Keep reusable framework behavior in `packages/openshop/src`; keep sample usage in `apps/demo` and templates.
- Do not duplicate framework behavior in templates or the demo app when it can live in OpenShop.
- If a public API changes, update docs, templates, and demo usage in the same change.
- Prefer existing config validation in `packages/openshop/src/config/validate.ts` for runtime shape checks.
- Preserve shop/app isolation by `(appHandle, shop)` in server and database behavior.
- Keep secrets in environment-backed config; never put API secrets in TOML examples.

## Shared App Code

- Keep `proxy/` route files as thin adapters for HTTP method handling, auth checks, params, body parsing, and response shaping.
- Put reusable app business logic in `server/`, reusable Admin GraphQL operations in `queries/`, and server-only utilities in `lib/server/`.
- Use `_`-prefixed files or directories under `proxy/` for route-local helpers that should not create routes, such as `proxy/garage/_service.ts` or `proxy/garage/_queries.ts`.
- Do not keep shared business logic inside a route file only to make GraphQL codegen see it; OpenShop scans `proxy`, `server`, `queries`, and `lib/server` by default.

## Flow And Provider Rules

- Flow steps must return JSON-serializable values because completed step output is persisted and reused on retry.
- Use `ctx.signal` for abort-aware long-running work and pass it to APIs that support aborting.
- Keep provider UI fields validated with ArkType validators.
- Keep connector methods typed through `defineProvider` rather than manually casting connector objects.

## UI Rules

- Match the existing compact admin UI instead of adding marketing-style layouts.
- Use App Bridge web components where the surrounding UI already uses them.
- Keep API fetch behavior routed through existing UI fetch helpers when possible.

## Customer Account Extensions

- Customer Account UI extensions should call OpenShop proxy handlers through `/ext/*` with `Authorization: Bearer <session token>`.
- Extension-backed proxy handlers should trust `ctx.shop`, `ctx.shopifyApp`, and `ctx.customerId`; do not trust customer IDs supplied by query strings or request bodies.
- Use `createShopifyClient(ctx.shop, ctx.shopifyApp)` inside extension-backed proxy handlers so multi-app installs resolve the correct access token.
- For extension frontend code, keep backend origin handling explicit: Shopify CLI tunnel origin in dev, deployed app origin or extension settings in production.
