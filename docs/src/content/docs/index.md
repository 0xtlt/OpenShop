---
title: OpenShop
description: Shopify integration framework documentation.
---

OpenShop is a Shopify integration framework for apps that need background flows, external providers, an embedded admin UI, app proxy routes, webhooks, database models, and Shopify Functions management without repetitive boilerplate.

:::caution[Beta]
OpenShop is currently in beta. APIs, configuration shape, generated files, and documented workflows are subject to change before a stable `1.0` release.
:::

## What OpenShop provides

- Checkpointed background flows with retry, sleep, cancellation, and logs.
- Provider definitions with typed config, generated admin forms, validation, health checks, and encrypted secrets.
- Shopify Admin GraphQL access with generated operation types.
- Embedded admin pages for flow runs, logs, crons, providers, and function instances.
- MCP tokens for scoped access to OpenShop tools and documentation resources.
- File-based app proxy routes and webhook handlers.
- Drizzle/PostgreSQL helpers for app models and framework tables.
- Test helpers for signed proxy requests, session tokens, connector fakes, and factories.

## Runtime shape

Production apps run two process types:

- `openshop start` serves HTTP routes, the embedded UI, webhooks, proxy routes, and cron dispatch.
- `openshop worker` executes queued flow runs.

This separation keeps web serving predictable and makes worker concurrency explicit.
