---
title: Building blocks
description: How app definitions, providers, connectors, flows, and configuration relate to each other.
---

OpenShop separates the code that knows **how to call a service** from the code
that decides **what work to do**. This keeps a warehouse client reusable across
order syncs, inventory updates, and reconciliation jobs.

## Providers become configured connectors

A **provider definition** describes an external service. It declares editable
configuration fields and methods such as `push(config, orders)`. OpenShop uses
the fields to render a form in the embedded admin.

A merchant saves a different configuration for each shop. When work runs,
OpenShop loads that shop's configuration and binds it to the provider methods.
The resulting **connector** exposes `push(orders)`: application code does not
have to retrieve or pass credentials on every call.

The provider definition belongs to the codebase. The saved provider
configuration belongs to an app/shop pair. The connector belongs to the current
execution context. Registering a provider does not configure its credentials.

## Flows describe work; runs record executions

A **flow definition** describes a background job, its input schema, and its
`run` function. A **flow run** is one execution of that definition, with its own
ID, input, status, step results, and logs.

Dispatching a flow stores a pending run. It does not synchronously execute the
job. A worker later claims the run and calls its function with the shop's
connectors and Shopify client.

A **step** is a named checkpoint inside that function. A completed checkpoint
stores a JSON result for reuse within the same run. See
[Checkpoints and retries](/concepts/checkpoints-and-retries/) for the guarantees.

## Two files avoid a dependency cycle

The generated project keeps its app definition and runtime configuration separate:

```text
providers/warehouse.ts
        ↓ imported by
openshop.app.ts          registers providers and creates typed helpers
        ↓ imported by
flows/syncOrders.ts      defines work using app.defineFlow()
        ↓ imported by
openshop.config.ts       registers flows, schedules, and runtime settings
```

`defineOpenShop({ providers })` creates `app`. Its helpers carry provider method
types into flows and routes. `app.defineConfig({ flows, ... })` then assembles
the runnable app and exposes `dispatchFlow()` for its registered flow keys.

Flows import `#app`, the alias for `openshop.app.ts`. Importing the final config
from a flow would introduce a cycle because that config imports the flow.

## Different entry points serve different callers

| Entry point | Typical caller | Role |
| --- | --- | --- |
| Embedded admin | Merchant or shop staff | Configure providers and inspect or trigger work |
| Cron | OpenShop scheduler | Dispatch work on a schedule |
| Webhook | Shopify | Handle an event or enqueue a flow |
| Proxy route | Storefront or Customer Account extension | Serve a Shopify-authenticated request |
| Server route | Another service | Handle an HTTP request with app-defined authentication |
| Custom admin page | Shop staff | Use app-owned screens and authenticated loaders/actions |

An HTTP handler can enqueue durable work and return promptly. It does not gain
flow checkpoints or retries merely by calling a provider.

Continue with [Architecture](/concepts/architecture/) for the process model, or
use the [configuration reference](/reference/configuration/) for exact options.
