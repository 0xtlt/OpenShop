---
title: Troubleshooting
description: Diagnose common OpenShop setup, authentication, migration, worker, GraphQL, and proxy failures.
---

Start with the process that owns the failed surface, then verify PostgreSQL:

```bash
pnpm exec openshop migrate status
curl -i http://localhost:3000/health
```

## The app does not install

1. Confirm the shop ends in `.myshopify.com`.
2. Verify `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, and `HOST`.
3. In multi-app mode, include `app=<handle>` and confirm that handle exists.
4. Deploy the matching Shopify TOML and ensure its application URL points to
   the same `HOST`.
5. Retry from `/auth?shop=<shop>&app=<handle>`.

An `Invalid HMAC` response means the request was not signed with the selected
app secret. A state error means the OAuth callback is stale or belongs to a
different installation attempt.

## The embedded UI returns 401

Open the app from Shopify admin instead of navigating directly to its host. The
production UI requires a valid shop launch and an installed shop. For API calls,
send a fresh App Bridge session token as a bearer token.

## Runs stay pending

`openshop start` queues runs but does not execute them.

```bash
pnpm exec openshop worker --concurrency=5
```

Check that web and worker use the same `DATABASE_URL` and built config. If a run
is scheduled in the future, inspect `availableAt`. If the worker repeatedly
loses work, compare `leaseDurationMs` with the longest non-checkpointed work.

## A run retries or fails unexpectedly

- Search the run logs and inspect the failed step.
- Ensure step output is JSON serializable.
- Make provider writes idempotent because a failed step can run again.
- Pass `ctx.signal` to abortable calls; JavaScript cannot forcibly stop
  arbitrary user code.
- Compare flow timeouts with retry delays. A retry scheduled after the flow
  deadline is not attempted.

## Database tables are missing

Apply the committed migration before starting either process:

```bash
pnpm exec openshop migrate
pnpm exec openshop migrate status
```

Generate migrations only during development or CI. Production schema generation
is intentionally blocked.

## GraphQL types are stale

```bash
pnpm run codegen
pnpm run lint
```

Confirm the operation is inside a supported ``#graphql`` literal and that the
configured Shopify scopes allow the operation.

## Proxy or extension calls return 401

For `/proxy/*`, configure a Shopify App Proxy or send a Customer Account session
JWT. For `/ext/*`, send a Customer Account JWT; App Proxy query HMAC alone is not
accepted. Verify the token audience matches the selected Shopify app.

## Provider secrets cannot be read back

Password fields are intentionally write-only. An empty password submitted from
the admin keeps the current value. To replace it, submit a new value. If the
`ENCRYPTION_KEY` changed, restore the original key; existing ciphertext cannot
be decrypted with a replacement.
