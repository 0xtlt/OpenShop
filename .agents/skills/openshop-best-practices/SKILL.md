---
name: openshop-best-practices
description: Use when working on OpenShop framework or app code, including TypeScript APIs, Shopify GraphQL, flows, webhooks, providers, proxy routes, server routes, CLI commands, database code, tests, templates, documentation, or the demo app. Apply OpenShop repo conventions, avoid unsafe generated GraphQL casts, and choose the right verification commands.
---

# OpenShop Best Practices

Use this skill to keep OpenShop changes aligned with the framework's local patterns.

## Start Here

Before editing:
- Inspect nearby source, tests, docs, and templates before choosing an implementation.
- Prefer existing helpers and boundaries in `packages/openshop/src` over new abstractions.
- Keep public APIs stable unless the user explicitly asks for a breaking change.
- Check whether a framework change also requires updates to `packages/openshop/templates/minimal`, `apps/demo`, or `docs/src/content/docs`.

## Reference Routing

- Read `references/graphql.md` before writing or changing Shopify GraphQL operations, codegen, `shopify.graphql()`, `.graphqlrc.ts`, or generated GraphQL type usage.
- Read `references/architecture.md` before changing engine, server, CLI, database, config, templates, providers, flows, webhooks, proxy routes, or UI boundaries.
- Read `references/testing.md` before adding tests, changing test setup, or choosing validation commands.

## Core Rules

- Use `pnpm` for workspace commands.
- Keep TypeScript strict and explicit at public boundaries.
- Treat broad type assertions as a last resort; prefer type inference, generic APIs, validators, or small local narrowing helpers.
- Preserve ESM imports with explicit `.ts` extensions when the surrounding code uses them.
- Keep tests close to the behavior: unit tests for pure helpers and integration tests for runtime contracts.

## Verification

For TypeScript code changes, run:

```bash
pnpm run check
```

For narrow changes, also run the most relevant package test command or specific spec described in `references/testing.md`.
