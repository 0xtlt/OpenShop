---
title: Connect an external service
description: Add a typed connector with normalization, validation, and a health check.
---

Use this guide to add a warehouse connector whose credentials are editable in
Shopify admin. Start with an existing OpenShop app and a warehouse API that
accepts authenticated `GET /health` and `POST /orders` requests. Adapt those two
paths and the authorization header to your service's API.

The generated tutorial provider is a logging stub. Replacing it with this code
makes real HTTP requests. Use the service's development credentials first.

## 1. Create the provider

Create `providers/warehouse.ts`:

```ts
import { type } from 'arktype'
import { defineProvider } from 'openshop'

export const warehouse = defineProvider({
  name: 'warehouse',
  ui: {
    fields: {
      apiUrl: {
        type: 'text',
        label: 'API URL',
        validate: type('string.url'),
      },
      apiKey: {
        type: 'password',
        label: 'API key',
        validate: type('string > 0'),
      },
      batchSize: {
        type: 'number',
        label: 'Batch size',
        required: false,
        validate: type('number.integer > 0'),
      },
    },
  },
  transformer({ data }) {
    return {
      ...data,
      apiUrl: String(data.apiUrl).replace(/\/$/, ''),
    }
  },
  async checker({ config }) {
    const res = await fetch(`${config.apiUrl}/health`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    })
    return res.ok
  },
  methods: {
    async push(config, rows: unknown[]) {
      const res = await fetch(`${config.apiUrl}/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(rows),
      })

      if (!res.ok) throw new Error(`Warehouse push failed: ${res.status}`)
    },
  },
})
```

The transformer removes a trailing slash from the URL. The field schemas reject
invalid URLs and empty API keys before configuration is saved. For the full save
pipeline and optional fields, see [Providers](/reference/providers/).

## 2. Register it

```ts
// openshop.app.ts
import { defineOpenShop } from 'openshop'
import { warehouse } from '#providers/warehouse'

export const app = defineOpenShop({
  providers: { warehouse },
})
```

Provider registration carries method types into flow connectors.

## 3. Save and check credentials

Open the embedded provider page, save the config, then run its check. Password
fields are write-only: the API returns `hasValue`, and submitting an empty
password preserves the stored secret.

The checker is manual. OpenShop does not call it before every flow method.
Saving a complete config marks the provider as configured. A successful check
then shows it as connected, and a failed check shows an error. Returning
`false` records an unsuccessful check; throwing returns HTTP 500.

## 4. Call the connector

Call the method inside a flow's `run({ connectors, step })` callback:

```ts
await step('push-orders', async () => {
  await connectors.warehouse.push([{ id: 'order-1' }])
})
```

The provider method receives saved config as its first argument, but the flow
connector omits it. If `connectors.warehouse` is missing, check registration in
`defineOpenShop()`.

## 5. Verify the integration

Run `pnpm run lint`, then use [Sync orders with a flow](/guides/define-flow/) to
call the connector. Confirm the provider check succeeds, the flow completes, and
the warehouse receives the expected records. A non-2xx warehouse response throws
and can trigger a flow retry, so make writes idempotent.

Before saving production credentials, configure the persistent encryption key
as described in [Deploy to production](/guides/deploy-production/). See
[provider secret behavior](/reference/providers/#secret-behavior) for storage and
password-update rules.
