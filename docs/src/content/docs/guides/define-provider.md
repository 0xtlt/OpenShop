---
title: Define a provider
description: Add a typed external connector with config fields, validation, and a health check.
---

Providers describe external services that flows can call. A provider owns its admin configuration fields and its callable methods.

## Create the provider file

Create `providers/warehouse.ts`:

```ts
import { type } from 'arktype'
import { defineProvider } from 'openshop'

export const warehouse = defineProvider({
  name: 'warehouse',
  ui: {
    fields: {
      apiUrl: { type: 'text', label: 'API URL', validate: type('string.url') },
      apiKey: { type: 'password', label: 'API key', validate: type('string > 0') },
    },
  },
  async checker({ config }) {
    const res = await fetch(`${config.apiUrl}/health`)
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

      if (!res.ok) {
        throw new Error(`Warehouse push failed: ${res.status}`)
      }
    },
  },
})
```

## Register it in the app

```ts
// openshop.app.ts
import { defineOpenShop } from 'openshop'
import { warehouse } from '#providers/warehouse'

export const app = defineOpenShop({
  providers: { warehouse },
})
```

OpenShop carries provider method types into flows. If a method accepts `rows: unknown[]`, then `connectors.warehouse.push(rows)` is type-checked where the flow calls it.

## Configure credentials

Open the embedded admin UI and save the provider config. Password fields are write-only in the admin API. Submitting an empty password value keeps the existing secret.

## Verify it worked

Run:

```bash
pnpm run lint
```

Then use the provider in a flow:

```ts
await connectors.warehouse.push([{ id: 'order-1' }])
```

If TypeScript cannot find `connectors.warehouse`, check that the provider is registered in `defineOpenShop()`.

## Production notes

Set `ENCRYPTION_KEY` in production. Provider configs are encrypted when `ENCRYPTION_KEY` is present, and production deployments should treat it as required.
