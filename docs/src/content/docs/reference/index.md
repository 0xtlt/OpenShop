---
title: Reference
description: API contracts, configuration options, command syntax, and runtime constraints for OpenShop.
---

Use reference pages when you know which feature you need and want its exact
contract. For a complete procedure, start with the [how-to guides](/guides/).

## Project and configuration

- [Project structure](/reference/project-structure/) — app-owned and generated files.
- [Configuration](/reference/configuration/) — registries, Shopify apps, crons, workers, and admin visibility.
- [Environment variables](/reference/environment-variables/) — defaults, requirements, and resolution order.
- [CLI commands](/reference/cli/) — commands, flags, scripts, and process behavior.
- [Public SDK](/reference/sdk/) — package entry points and exports.

## Background work and storage

- [Flows](/reference/flows/) — inputs, runtime context, checkpoints, retries, and cancellation.
- [Providers](/reference/providers/) — fields, validation, connectors, and credentials.
- [Database and migrations](/reference/database/) — models, queries, and schema ownership.
- [Logging](/reference/logging/) — structured logs and export.
- [Errors](/reference/errors/) — framework error types and failure contracts.
- [Testing](/reference/testing/) — test contexts, fakes, signed requests, and factories.

## Shopify and HTTP

- [Authentication](/reference/authentication/) — credentials and identity for each HTTP surface.
- [Admin API](/reference/admin-api/) — authenticated endpoint contracts.
- [GraphQL codegen](/reference/graphql-codegen/) — operation types and Shopify client behavior.
- [Proxy routes](/reference/proxy-routes/) — storefront and Customer Account endpoints.
- [Server routes](/reference/server-routes/) — explicit authentication and Web `Response` handlers.
- [Webhooks](/reference/webhooks/) — topic matching, context, and acknowledgment behavior.
- [Shopify Functions](/reference/shopify-functions/) — Function definitions and configuration.
- [Custom admin pages](/reference/custom-admin-pages/) — experimental pages, loaders, actions, and policies.
- [MCP](/reference/mcp/) — tokens, permissions, tools, resources, and JSON-RPC errors.

## Security and compatibility

- [Security](/reference/security/) — secret handling and trust boundaries.
- [Versioning](/reference/versioning/) — beta compatibility and generated project updates.
