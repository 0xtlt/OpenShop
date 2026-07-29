---
title: Define a provider
description: Add a typed connector with normalization, validation, and a health check.
---

Providers own the configuration and methods for an external service.

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

Save processing is ordered: password preservation, coercion, required checks,
`transformer`, required checks again, then ArkType validation. A transformer
must return an object.

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
Returning `false` records an unsuccessful check; throwing returns HTTP 500.

## 4. Call the connector

```ts
await connectors.warehouse.push([{ id: 'order-1' }])
```

The provider method receives saved config as its first argument, but the flow
connector omits it. If `connectors.warehouse` is missing, check registration in
`defineOpenShop()`.

## 5. Verify production secrets

Set a stable, 64-hex-character `ENCRYPTION_KEY` in production before saving
credentials. Production throws when it is missing; development logs a warning
and stores plaintext. Passwords are omitted from API reads, but storage
encryption depends on that key. Rotating it without a data migration makes
existing encrypted configs unreadable.
