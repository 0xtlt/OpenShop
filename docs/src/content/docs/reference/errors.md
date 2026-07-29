---
title: Errors
description: OpenShop error classes, HTTP failures, flow outcomes, and recovery actions.
---

## Flow errors

| Error | Meaning | Recovery |
| --- | --- | --- |
| `FlowConcurrencyError` | A `pending`, `running`, or `sleeping` run already exists for the same app, shop, and flow while concurrency is `reject`. | Reuse or wait for the existing run, or opt into `allow` when parallel execution is safe. |
| `StepTimeoutError` | A step exceeded its effective timeout. | Shorten the operation, increase `stepTimeout`, or pass the abort signal to the client. |
| `FlowTimeoutError` | The flow deadline was exceeded. | Increase `timeout` or split the job. |
| `FlowCanceledError` | The run was canceled and its abort signal fired. | Stop external work and do not swallow the error. |
| `SleepSignal` | Internal continuation signal created by `step.sleep()`. | Do not catch it as an application failure. |

Normal run states are `pending`, `running`, `sleeping`, `completed`, `failed`,
and `canceled`. A worker lease loss is an execution result used to prevent an
outdated worker from committing over a newer lease.

## HTTP status conventions

| Status | Meaning |
| --- | --- |
| `400` | Invalid query, body, configuration, or operation state. |
| `401` | Missing or invalid Shopify, proxy, webhook, or MCP authentication. |
| `403` | Authenticated MCP token lacks permission, is disabled, revoked, or expired. |
| `404` | Flow, run, provider, Function instance, resource, or static route not found. |
| `409` | State conflict such as a revoked MCP token mutation. |
| `413` | MCP request body exceeds its accepted limit. |
| `500` | Handler, provider, Shopify, database, or unexpected runtime failure. |

Error bodies generally contain an `error` message. MCP protocol failures use a
JSON-RPC error object instead. Treat message text as diagnostic, not as a stable
machine-readable code unless the endpoint documents one.

## Application error hook

Configure `onError` for centralized reporting:

```ts
export default app.defineConfig({
  flows,
  async onError(error, context) {
    await errorReporter.capture(error, {
      flow: context?.flow,
      step: context?.step,
    })
  },
})
```

The hook supplements stored logs. It does not replace throwing errors from
failed provider or Shopify operations.
