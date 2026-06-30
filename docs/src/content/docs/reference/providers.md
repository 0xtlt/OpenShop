---
title: Providers
description: Provider fields, methods, checks, and secret behavior.
---

Providers describe external services used by flows.

## Definition

```ts
export const warehouse = defineProvider({
  name: 'warehouse',
  ui: {
    fields: {
      apiUrl: { type: 'text', label: 'API URL' },
      apiKey: { type: 'password', label: 'API key' },
    },
  },
  async checker({ config }) {
    const res = await fetch(`${config.apiUrl}/health`)
    return res.ok
  },
  methods: {
    async push(config, rows: unknown[]) {
      // ...
    },
  },
})
```

## Field types

| Type | Use |
| --- | --- |
| `text` | Plain text values. |
| `password` | Secrets. Values are not returned through the admin API. |
| `number` | Numeric values. |
| `select` | One value from an option list. |
| `checkbox` | Boolean values. |

Fields support `label`, `placeholder`, `options`, `required`, and `validate`.

## Methods

Provider methods receive the saved provider config as their first argument. OpenShop removes that first argument from the connector type exposed to flows.

```ts
// provider method
async push(config, rows: unknown[]) {}

// flow connector
await connectors.warehouse.push(rows)
```

## Secrets

Password fields are never returned through the admin API. Existing password values can be kept by submitting an empty value.

Provider configs are encrypted when `ENCRYPTION_KEY` is set. In production, set `ENCRYPTION_KEY`.
