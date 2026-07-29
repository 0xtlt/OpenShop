---
title: Architecture
description: How the OpenShop web process, scheduler, workers, PostgreSQL, Shopify, and providers fit together.
---

An OpenShop deployment has two long-running processes backed by one PostgreSQL
database:

```text
Shopify admin / webhooks / proxies
                 |
                 v
        web process (`openshop start`)
        - OAuth and session authentication
        - embedded admin UI and Admin API
        - webhook, proxy, Function, and MCP routes
        - cron scheduler
                 |
                 | inserts pending flow runs
                 v
              PostgreSQL
        - installations and encrypted tokens
        - provider configuration
        - flow runs, checkpoints, and logs
        - cron overrides and MCP audit data
                 ^
                 | leases and executes runs
                 |
       worker process (`openshop worker`)
        - provider connectors
        - Shopify Admin GraphQL
        - checkpointed steps and retries
```

The web and worker processes use the same built `openshop.config.ts` and
`DATABASE_URL`. The web process does not execute flows. A deployment therefore
needs at least one instance of each process.

## Request lifecycle

1. Shopify launches the embedded app or calls an authenticated route.
2. OpenShop resolves the Shopify app and shop identity.
3. A cron, API request, webhook, or application service dispatches a flow.
4. The run is stored as `pending`; a worker leases it when `availableAt` is due.
5. Each `step()` writes a checkpoint. A retry reuses completed step output.
6. The run ends as `completed`, `failed`, or `canceled`; logs remain queryable.

## Identity and tenancy

Shop-scoped framework data is identified by `(appHandle, shop)`. In single-app
mode, `appHandle` is `default`. Multi-app deployments use the key declared under
`shopify.apps`. This boundary applies to installations, flow runs, provider
configuration, cron overrides, Functions, and MCP tokens.

Application tables created with `defineModel()` include a `shop` column by
default, but application code is responsible for applying the correct shop
filter to its own queries.

## Scaling boundaries

- Run one scheduler unless duplicate cron attempts are acceptable. The scheduler
  has no leader election. Flow concurrency can reject an overlapping run, but
  it is not a scheduler de-duplication guarantee.
- Run multiple workers against the same database to increase throughput.
- Set worker concurrency below the combined PostgreSQL and provider capacity.
- Keep migrations separate from process startup so every replica sees the same
  schema before it begins serving traffic.

See [Deploy to production](/guides/deploy-production/) and
[Operate an app](/guides/operate-app/) for process and recovery procedures.
