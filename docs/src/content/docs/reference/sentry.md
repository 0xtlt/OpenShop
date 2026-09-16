---
title: Sentry
description: Native Sentry error reporting for OpenShop web, worker, and development processes.
---

OpenShop initializes [Sentry](https://sentry.io/) when `SENTRY_DSN` is set.
App authors do not install `@sentry/node` or wire `onError` just to get
backend error reports.

This covers the Node web process, the worker process, and `openshop dev`.
It does not initialize a browser SDK for the embedded admin UI.

## Enable

Set a DSN in the process environment. `openshop dev` loads it from `.env`.
Production `openshop start` and `openshop worker` expect the platform to inject
it.

```dotenv
SENTRY_DSN=https://<key>@o<org>.ingest.sentry.io/<project>
SENTRY_ENVIRONMENT=production
SENTRY_RELEASE=1.2.3
SENTRY_TRACES_SAMPLE_RATE=0
```

Restart both the web process and every worker after changing these variables.
Give every replica the same DSN, environment, and release.

## What OpenShop reports

| Source | When |
| --- | --- |
| Flow failures | After each failed attempt, including retries. Canceled runs and `step.sleep()` are not reported. |
| Webhooks | Handler throws. OpenShop still returns HTTP 200 to Shopify. |
| Proxy and public routes | Handler or route authentication throws and OpenShop returns HTTP 500. |
| Worker | Unregistered flows and unexpected worker errors. |
| Scheduler | Cron dispatch throws for a shop. |
| CLI boot | Built config fails to load. |
| Unhandled | The Sentry Node SDK captures uncaught exceptions and unhandled rejections. |

Events include tags for `openshop.process` (`web`, `worker`, or `dev`),
`openshop.mechanism`, and when known `shop`, `shopifyApp`, `flow`, and route.

`onError` still runs for flow failures. Keep it for extra application reporting;
Sentry does not replace it.

## Sampling and PII

`SENTRY_TRACES_SAMPLE_RATE` defaults to `0` (errors only). Set a value between
`0` and `1` to enable performance traces. OpenShop initializes Sentry before
loading application config so Node auto-instrumentation can wrap PostgreSQL and
HTTP when tracing is on.

OpenShop sets `sendDefaultPii: false` and redacts sensitive query parameters
(`id_token`, `hmac`, `signature`, `token`, `code`, and similar keys) from
captured request URLs. Do not put access tokens, encryption keys, or session
tokens in custom tags.

## Optional config

DSN, environment, release, and trace sampling come from environment variables
so they are available before `openshop.config.ts` loads. Config can only add
static tags or disable Sentry after load:

```ts
export default app.defineConfig({
  flows,
  sentry: {
    tags: { region: 'eu' },
  },
})
```

`sentry.enabled: false` closes Sentry even when `SENTRY_DSN` is set. Use
`SENTRY_ENABLED=false` to skip initialization entirely.

## Embedded hosts

CLI commands call `initOpenShopSentry()` before loading config. Hosts that
start OpenShop without the CLI should do the same after environment variables
are available:

```ts
import { flushOpenShopSentry, initOpenShopSentry } from 'openshop'

await initOpenShopSentry({ process: 'web' })
```

Call `flushOpenShopSentry()` during graceful shutdown. `captureOpenShopException()`
reports extra application errors with the same OpenShop tags.
