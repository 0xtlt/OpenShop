---
title: Logging
description: Structured flow logs, runtime logs, filtering, export, and custom runtime logger integration.
---

OpenShop has two logging surfaces:

- flow logs written through `ctx.logger` and stored in PostgreSQL;
- runtime logs written by the web process, worker, scheduler, and server.

## Flow logger

```ts
export const syncOrders = app.defineFlow({
  name: 'syncOrders',
  async run({ logger, step }) {
    logger.info({ source: 'shopify' }, 'Starting order sync')

    await step('push', async () => {
      try {
        // provider call
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'Provider push failed',
        )
        throw error
      }
    })
  },
})
```

`info`, `warn`, and `error` accept a JSON-serializable payload and an optional
message. Logs are associated with the current run and appear in the embedded
admin. The Admin API supports level/text filters, context expansion, and JSON or
CSV export. The current run-log endpoint returns the complete filtered set and
does not provide pagination.

Do not log access tokens, provider passwords, session tokens, OAuth state, or
personal data that is not required for diagnosis.

## Runtime logger

Applications that embed OpenShop logging into another logger can install the
public runtime adapter:

```ts
import { setRuntimeLogger } from 'openshop'

setRuntimeLogger({
  info(message, meta) {
    console.info(message, meta)
  },
  warn(message, meta) {
    console.warn(message, meta)
  },
  error(message, meta) {
    console.error(message, meta)
  },
})
```

Call `setRuntimeLogger()` before starting OpenShop processes in an embedded
runtime. `getRuntimeLogger()` returns the active adapter. The CLI uses the
default console-backed logger unless application bootstrap replaces it.

## Retention and export

OpenShop does not currently apply an automatic retention policy to flow logs.
Plan database retention, backup, and deletion according to application
requirements. Export is intended for diagnosis, not as a durable analytics
pipeline.
