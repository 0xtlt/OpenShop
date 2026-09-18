---
title: Shop and app isolation
description: Understand the distinction between a Shopify app, a shop, an installation, and application-owned data.
---

A Shopify **app** has a client ID and secret. A **shop** is a store such as
`example.myshopify.com`. An **installation** connects one app to one shop.
One OpenShop deployment can serve several apps, and each app can be installed
on several shops.

## The tenant is an app/shop pair

Framework state uses `(appHandle, shop)`. Single-app mode uses the handle
`default`; explicit multi-app mode uses the keys under `shopify.apps`.
The same shop installing two different apps therefore has two installations
and two provider configurations.

This scope applies to framework installations, provider configurations, flow
runs, cron overrides, Function configuration, and MCP tokens. The runtime
context exposes the handle as `shopifyApp`.

Shopify credentials establish the identity at the HTTP boundary. For example,
a session token's audience selects the app, while its verified destination
identifies the shop. Client-supplied fields do not establish that identity.
See [Authentication](/reference/authentication/) for each surface's contract.

## App-owned tables require app-owned filters

`defineModel()` adds a `shop` column by default. It does **not** automatically add
an app handle or restrict Drizzle queries. Application code must filter by the
trusted identity from the runtime context.

For data that differs between apps installed on the same shop, add an app-handle
column and include both values in reads, writes, and uniqueness constraints.
A `shop` filter alone cannot distinguish those installations. The same rule
applies to custom admin loaders and actions: their `db` client is raw Drizzle.

## Shared hosting does not mean independent configuration

All Shopify apps in one OpenShop instance share the flow/provider definitions,
database schema, and OAuth scopes. Credentials and shop-scoped state are separate.
If two apps need incompatible scopes or release schedules, separate deployments
may be easier to operate.

Keep handles stable: changing a handle changes the identity used to find stored
state. Changing an encryption key also needs a data migration; it is not an
ordinary configuration rename.

For setup steps, use [Configure Shopify apps](/guides/configure-shopify-apps/).
For application models, see [Database and migrations](/reference/database/).
