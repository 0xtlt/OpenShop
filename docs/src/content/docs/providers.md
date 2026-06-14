---
title: Providers
description: Define external connectors and provider config UI.
---

Providers describe external services used by flows.

```ts
import { defineProvider } from 'openshop'
import { type } from 'arktype'

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
      await fetch(`${config.apiUrl}/orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify(rows),
      })
    },
  },
})
```

## Config fields

Supported field types:

- `text`
- `password`
- `number`
- `select`
- `checkbox`

Password fields are never returned through the admin API. Existing password values can be kept by submitting an empty value.

## Secrets

Provider configs are encrypted when `ENCRYPTION_KEY` is set. In production, `ENCRYPTION_KEY` is required.
