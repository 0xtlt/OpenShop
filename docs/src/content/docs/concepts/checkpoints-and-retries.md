---
title: Checkpoints and retries
description: Understand replay, persisted step output, retries, sleeps, and the limits of checkpoint guarantees.
---

A checkpoint lets a run reuse completed work after a failure or a pause. It does
not make an external API call and a PostgreSQL write one atomic operation.
That distinction matters for order creation, payments, emails, and other side effects.

## The function starts again; completed steps supply their results

Consider an order-sync flow with two steps:

```text
Attempt 1: fetch-orders → saved result → push-orders fails
Attempt 2: fetch-orders → cached result → push-orders runs again
```

OpenShop re-enters the flow function. When it reaches `fetch-orders`, the step
helper returns the stored result without invoking that callback. Code outside
steps executes again, including logging, random values, and network calls.

Checkpoints are identified by run ID and step name. A new run has fresh
checkpoints. Changing a step name in a deployment creates a new checkpoint for
runs that resume on the new code, so step names are part of the persisted
workflow contract.

## A successful side effect can still repeat

There is a window between an external service accepting a request and OpenShop
saving the completed step:

```text
Warehouse accepts order → worker exits → checkpoint was never saved
```

A later attempt cannot know the warehouse already accepted the order. It calls
the service again. Use the service's idempotency mechanism with a stable business
identifier, or design the write as an upsert. A named step reduces repeated
work; it does not guarantee exactly-once delivery.

The default concurrency policy rejects overlapping runs for the same app, shop,
and flow. It does not deduplicate two separate runs that happen one after the
other, or writes made by different flows.

## Stored values cross a JSON boundary

The first execution returns the callback's value; replay returns its JSON-stored
representation. Return plain objects, arrays, strings, numbers, booleans, or
`null` so those two paths behave consistently. Convert a `Date` to an ISO string
before returning it. `Response`, `ArrayBuffer`, class instances, and values such
as `BigInt` are unsuitable checkpoint outputs.

`undefined` is stored as `null`. Avoid relying on the difference in code that
consumes step output.

## Retry, resume, and reset have different effects

| Operation | Checkpoint behavior |
| --- | --- |
| Automatic retry after failure | Reuses completed step results within the existing run |
| Manual retry in resume mode | Keeps completed steps and retries unfinished work |
| Manual retry in reset mode | Discards step results and starts the work again |
| Dispatch a new run | Creates an independent set of checkpoints |

Retries use the configured attempt limit and backoff. A flow deadline can stop
further retries even when attempts remain. The
[flow reference](/reference/flows/) gives the exact defaults and precedence.

## Sleep releases capacity; cancellation requires cooperation

`step.sleep()` records when the run can resume and releases its worker slot.
The worker later re-enters the flow and reuses completed checkpoints. A regular
JavaScript timer inside a step keeps the worker occupied instead.

Cancellation signals the running code through `ctx.signal`. Pass it to APIs
that accept an abort signal. A timeout stops OpenShop waiting for code; it cannot
forcibly stop an arbitrary external operation that has already started.

Try the [checkpoint tutorial](/tutorials/checkpointed-flow/) to observe replay,
or use [Operate an app](/guides/operate-app/) to recover a failed run.
