---
title: Flows
description: Flow options, retries, cancellation, and checkpointed steps.
---

Flows are background jobs dispatched to an OpenShop worker.

```ts
import { type } from 'arktype'
import { app } from '#app'

const syncOrders = app.defineFlow({
  name: 'syncOrders',
  input: type({ limit: 'number.integer > 0' }),
  timeout: 60_000,
  stepTimeout: 15_000,
  concurrency: 'reject',
  retryPolicy: { maxAttempts: 3 },
  async run({ input, logger, step }) {
    const batch = await step('prepare-batch', () => ({
      requested: input.limit,
      preparedAt: new Date().toISOString(),
    }))

    logger.info(batch, 'Order batch prepared')
  },
})
```

## Definition options

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `name` | `string` | Required | Descriptive definition name. Keep it equal to the key used in `config.flows`. |
| `input` | ArkType `Type` | None | Validated in the worker before `run()`. Invalid input fails the run. |
| `timeout` | Positive `number` | None | Per-attempt execution timeout; also anchors the retry deadline at dispatch time. |
| `stepTimeout` | Positive `number` | None | Default timeout for every `step()`. |
| `concurrency` | `'reject' \| 'allow'` | `'reject'` | Controls overlapping active runs for the same app, shop, and flow. |
| `retryPolicy` | `Partial<RetryPolicy>` | App policy | Overrides the app-level policy. |
| `run` | `(ctx) => Promise<void>` | Required | Flow implementation. |

`openshop.dispatchFlow()` returns `{ runId, status: 'pending' }`. Its `delayMs` and
`retryPolicy` options override the flow and app values for that run.
The `config.flows` object key—not `flow.name`—is the runtime identifier used by
dispatch, crons, runs, and logs.

## Runtime context

| Property | Contract |
| --- | --- |
| `input` | ArkType-validated input, or the dispatched object when no schema exists. |
| `connectors` | Provider methods with their first `config` argument removed. |
| `shopify` | Admin GraphQL client for the run's app and shop. |
| `shop` | Shop domain associated with the run. |
| `shopifyApp` | Internal app handle (`default` in legacy single-app mode). |
| `step` | Checkpointed step helper. |
| `logger` | `info`, `warn`, and `error` structured logging methods. |
| `signal` | Abort signal set when the run is canceled. |
| `db` | Drizzle database client. |

## Retry precedence and defaults

Retry settings merge from least to most specific:

1. OpenShop defaults
2. `config.retryPolicy`
3. `flow.retryPolicy`
4. `openshop.dispatchFlow({ options: { retryPolicy }, ... })`

| Field | Default | Meaning |
| --- | --- | --- |
| `maxAttempts` | `3` | Total attempts, including the first. |
| `initialIntervalMs` | `1_000` | Delay before the first retry. |
| `backoffCoefficient` | `2` | Exponential multiplier. |
| `maxIntervalMs` | `30_000` | Delay cap. |

A retry is not scheduled when `maxAttempts` is reached or when its next start
would be at or after the deadline stored at dispatch. Each attempt still uses
the full `timeout` in its execution race. `onError` runs after each failed
attempt; errors thrown by `onError` are ignored.

## Concurrency

With the default `reject` policy, dispatch obtains a PostgreSQL advisory lock
and rejects a second `pending`, `running`, or `sleeping` run for the same
`(shopifyApp, shop, flowName)`. It throws `FlowConcurrencyError`, whose
`existingRunId` identifies the active run. `allow` skips that check.

## Checkpointed steps

```ts
const orders = await step(
  'fetch-orders',
  () => shopify.graphql(query, { variables }),
  { timeout: 10_000 },
)
```

`step(name, fn, options?)`:

- returns a previously completed step's stored output without calling `fn`;
- uses `options.timeout` before the flow's `stepTimeout`;
- stores `undefined` as JSON `null`;
- stores failures per run attempt, then lets the flow retry;
- requires JSON-serializable output because storage uses JSON serialization.

Step names must be stable and unique within the logical run. A renamed step is
a new checkpoint.

## Sleeping without a worker slot

```ts
await step.sleep('rate-limit-window', 30_000)
```

The first call records a resume timestamp and moves the run to `sleeping`.
When a worker picks it up after that timestamp, the sleep checkpoint completes
and execution continues. Retries reuse the stored timestamp rather than adding
another full delay.

## Cancellation and timeouts

Cancellation aborts `ctx.signal`. OpenShop checks it before and after steps and
marks the run and active step canceled. Pass the signal to APIs that support it:

```ts
await fetch(url, { signal })
```

Flow and step timeouts reject the OpenShop wait with `FlowTimeoutError` or
`StepTimeoutError`; JavaScript cannot forcibly stop arbitrary user code. Code
that ignores `signal` may continue doing work after the run has been marked.
