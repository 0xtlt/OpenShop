---
title: Build a checkpointed flow
description: Write a flow that saves a result, pauses, and resumes using the original checkpoint.
---

In this lesson, we will add a small report flow to the app from
[Build your first app](/tutorials/first-app/). It will save a timestamp, sleep for
10 seconds, and log a report using that saved value. It makes no external API
calls and does not change store data.

Keep `pnpm run shopify` running and open the installed app in Shopify admin.

## 1. Write the flow

Create `flows/prepareReport.ts`:

```ts
import { type } from 'arktype'
import { app } from '#app'

export const prepareReport = app.defineFlow({
  name: 'prepareReport',
  input: type({ label: 'string > 0' }),

  async run({ input, step, logger }) {
    const report = await step('prepare-report', async () => {
      const result = {
        label: input.label,
        preparedAt: new Date().toISOString(),
      }
      logger.info(result, 'Prepared report')
      return result
    })

    await step.sleep('wait-before-publishing', 10_000)

    await step('publish-report', async () => {
      logger.info(report, 'Published report')
    })
  },
})
```

The report is an ordinary JSON object. `step()` saves its result so the resumed
flow can use the same timestamp.

## 2. Register it

Replace `openshop.config.ts` with:

```ts
import { app } from '#app'
import { syncOrders } from '#flows/syncOrders'
import { prepareReport } from '#flows/prepareReport'

export default app.defineConfig({
  flows: { syncOrders, prepareReport },
  crons: [],
})
```

Wait for the development server to reload, then refresh **Flows**. You should
see `prepareReport` alongside `syncOrders`.

## 3. Observe the pause

Trigger `prepareReport` with:

```json
{ "label": "My first report" }
```

Open the run immediately. During the 10-second pause, its status is `sleeping`.
After the worker picks it up again, it becomes `completed`. If you miss the
sleeping state, the step history still shows the pause.

Inspect the logs:

- **Prepared report** appears once.
- **Published report** contains the same `preparedAt` timestamp.
- The run has checkpoints for `prepare-report`, `wait-before-publishing`, and `publish-report`.

The worker re-entered the flow after the sleep. The completed `prepare-report`
checkpoint supplied its stored result, so the callback did not run again.

## 4. Start a separate run

Wait for completion, then trigger `prepareReport` again from the flow page.
The new run prepares a new timestamp. Checkpoints belong to a particular run;
they are not shared between independent runs.

Run `pnpm run lint` from a second terminal in the project directory.

## What you built

You wrote and registered a flow, validated its input, and observed a saved
checkpoint across a pause. Read [Checkpoints and retries](/concepts/checkpoints-and-retries/)
for the failure cases and why external writes still need idempotency.
When you are ready to call a real service, use
[Connect an external service](/guides/define-provider/) and
[Sync orders with a flow](/guides/define-flow/).
