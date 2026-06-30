---
title: Flows
description: Flow definition options and runtime context.
---

Flows are background jobs executed by OpenShop workers.

## Definition

```ts
const syncOrders = app.defineFlow({
  name: 'syncOrders',
  input: type({ limit: 'number.integer > 0' }),
  timeout: 60_000,
  stepTimeout: 15_000,
  concurrency: 'reject',
  retryPolicy: { maxAttempts: 3 },
  async run(ctx) {
    // ...
  },
})
```

## Options

| Option | Type | Purpose |
| --- | --- | --- |
| `name` | `string` | Stable flow name used by config, crons, and admin UI. |
| `input` | ArkType schema | Optional runtime input validation. |
| `timeout` | `number` | Flow timeout in milliseconds. |
| `stepTimeout` | `number` | Default timeout for each step. |
| `concurrency` | `'reject' \| 'allow'` | Whether concurrent runs are rejected or allowed. |
| `retryPolicy` | `Partial<RetryPolicy>` | Flow-specific retry behavior. |
| `run` | `(ctx) => Promise<void>` | Flow implementation. |

## Runtime context

| Property | Purpose |
| --- | --- |
| `input` | Validated flow input. |
| `connectors` | Provider methods with the config argument removed. |
| `shopify` | Shopify Admin GraphQL client for the current shop. |
| `shop` | Current shop domain. |
| `shopifyApp` | Internal app handle for multi-app deployments. |
| `step` | Checkpointed step helper. |
| `logger` | Structured flow logger. |
| `signal` | Abort signal for canceled or timed-out runs. |
| `db` | Drizzle database client. |

## Steps

`step(name, fn)` stores completed output. If a run is retried, completed steps are skipped and their stored output is returned.

Step output must be JSON serializable.

Use `step.sleep(name, durationMs)` for delayed continuation without holding a worker slot:

```ts
await step.sleep('wait-for-rate-limit', 30_000)
```
