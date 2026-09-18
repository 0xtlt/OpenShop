---
title: Operate an OpenShop app
description: Run, monitor, scale, and safely stop OpenShop web and worker processes.
---

Use this guide after [deploying the app](/guides/deploy-production/). You need
access to the embedded admin and to the web and worker service logs.
For the process model, read [Architecture](/concepts/architecture/).

## 1. Start separate processes

Web service:

```bash
pnpm exec openshop start
```

Worker service:

```bash
pnpm exec openshop worker --concurrency=5
```

Do not place the commands sequentially in one shell script: `openshop start` is
long-running, so the worker line would never execute. Configure two services,
containers, process-manager entries, or terminal sessions.

## 2. Check health and run a smoke flow

The unauthenticated health endpoint confirms only that the HTTP process responds:

```bash
curl --fail --silent https://your-app.example.com/health
```

Expected shape:

```json
{
  "status": "ok",
  "timestamp": "2026-07-29T12:00:00.000Z"
}
```

It does not prove PostgreSQL, Shopify, or workers are healthy. Complete a smoke
check by dispatching a harmless flow from the embedded admin UI and watching it
move from `pending` to `completed`.

## 3. Monitor runs

In the embedded admin UI:

1. Filter runs by `pending`, `running`, `sleeping`, or `failed`.
2. Open a run to inspect step status and structured logs.
3. Select **Retry**, then **Resume** on a finished run to keep completed steps.
4. Use **Restart** (the API's `reset` mode) only when completed steps are safe to execute again.

Operational signals:

| Signal | Likely cause | Action |
| --- | --- | --- |
| Growing `pending` count | No worker, saturated concurrency, or DB failure | Check worker processes and database connectivity; then scale workers. |
| Old `running` runs | Worker crash or a long step | Check worker logs and step timeout; expired leases allow another worker to reclaim work. |
| Repeated `sleeping` runs | Retrying failures or explicit `step.sleep` | Inspect run logs and `availableAt`. |
| Many `failed` runs | Provider, Shopify, validation, or deployment regression | Filter logs by error and compare the first failure time with deployments. |
| Cron absent | Bad schedule, disabled per-shop override, or web process down | Check config, cron toggle, and web/scheduler process. |

## 4. Scale workers

Start additional identical worker processes against the same database. Workers use
PostgreSQL row locking with `SKIP LOCKED`, so separate processes can safely claim
different runs.

Configure defaults in `openshop.config.ts`:

```ts
import { app } from '#app'
import { syncOrders } from '#flows/syncOrders'

export default app.defineConfig({
  flows: { syncOrders },
  worker: {
    concurrency: 5,
    pollIntervalMs: 1_000,
    pollMaxIntervalMs: 5_000,
    pollBackoffCoefficient: 1.5,
    leaseDurationMs: 30_000,
  },
})
```

A CLI `--concurrency` override wins for that worker process. The complete
[worker defaults](/reference/configuration/#worker-defaults) are in the reference.

Scale gradually. Total simultaneous flow runs are approximately:

```text
worker process count × concurrency per worker
```

Also budget PostgreSQL connections per process using `PGPOOL_MAX`.

## Recover failed runs

1. Open the failed run and find the first failed step and its error.
2. Correct the cause, such as invalid provider credentials or missing Shopify scopes.
3. Select **Retry**, then **Resume** to reuse completed checkpoints.
4. Verify the resumed run completes and check the downstream result.

Choose **Restart** only if every side effect can safely happen again. Read
[Checkpoints and retries](/concepts/checkpoints-and-retries/) before resetting a
run that writes to another system.

## Cancel, retry, and delete safely

- Cancel requests mark an active run `canceled` and signal the process currently
  executing it.
- Long-running libraries stop promptly only when they receive `ctx.signal`.
- Resume retry keeps completed steps; reset retry discards all step results.
- Active runs must be canceled before deletion.
- Bulk delete accepts at most 100 IDs and skips active runs.

Pass the abort signal to compatible APIs:

```ts
import { app } from '#app'

export const refreshCatalog = app.defineFlow({
  name: 'refreshCatalog',
  async run({ signal, step }) {
    await step('download catalog', async () => {
      const response = await fetch('https://catalog.example.com/export', { signal })
      if (!response.ok) throw new Error(`Catalog returned ${response.status}`)
      return response.text()
    })
  },
})
```

## Graceful deployment

1. Stop routing new HTTP traffic to the old web process.
2. Send `SIGTERM` to old workers.
3. Allow at least `leaseDurationMs` for active work to finish.
4. Apply committed database migrations.
5. Start the new web process and workers from the same build.
6. Dispatch one harmless flow and confirm completion.

The worker stops claiming new runs on shutdown and waits up to its lease duration
for active runs. If a process dies, its leases eventually expire and another worker
can reclaim the runs.

## Backups and incident data

Back up PostgreSQL using your managed database policy. OpenShop state includes
installations, encrypted access tokens, provider configurations, flow runs, steps,
logs, cron overrides, and MCP tokens/audits.

During an incident, preserve:

- application version and deployment time;
- web and worker process logs;
- affected run IDs and exported run logs;
- database health and connection saturation;
- recent provider, Shopify scope, encryption-key, or environment changes.

Never publish exported logs without checking their structured payloads for customer
or order data.

For log queries and exports, see [Logging](/reference/logging/). For API status
codes and retry endpoints, see [Admin API](/reference/admin-api/).
