---
title: Providers
description: Provider fields, transformation, validation, checks, and secrets.
---

Providers describe external services used by flows.

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
      const res = await fetch(`${config.apiUrl}/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(rows),
      })
      if (!res.ok) throw new Error(`Warehouse returned ${res.status}`)
      return res.json()
    },
  },
})
```

## Field definitions

All fields require `type` and a non-empty `label`.

| Type | Saved value | Notes |
| --- | --- | --- |
| `text` | String-like input | Supports `placeholder`. |
| `password` | Secret input | Omitted from read responses; an empty update preserves the stored value. |
| `number` | Number | A non-empty string is converted with `Number()`. |
| `select` | Selected string | Requires non-empty, uniquely valued `options`. |
| `checkbox` | Boolean | The string `"true"` is true; other strings are false. |

`required` defaults to `true`. Set `required: false` to make a field optional.
`validate` accepts an ArkType schema. Its transformed value becomes the saved
value.

## Save pipeline

When a provider configuration is saved, OpenShop:

1. keeps an existing password when the submitted value is missing or empty;
2. coerces number and checkbox inputs;
3. checks required fields;
4. calls `transformer({ data })`, when defined;
5. requires the transformer result to be an object;
6. checks required fields again and runs each ArkType validator;
7. encrypts and upserts the resulting object for the current app and shop.

`transformer` can normalize fields or add provider-specific values:

```ts
transformer({ data }) {
  return {
    ...data,
    apiUrl: String(data.apiUrl).replace(/\/$/, ''),
  }
}
```

Errors are explicit: missing values report `Field "name" is required`,
validation errors report `Field "name": ...`, and non-object transformer
results report `Provider transformer must return an object`.

## Methods and connectors

The saved config is the first argument of each provider method:

```ts
async push(config, rows: unknown[]) {}
```

Flows receive the method without that argument:

```ts
await connectors.warehouse.push(rows)
```

OpenShop loads the app/shop-specific config before building connectors. It does
not automatically run `checker` before a method call.

## Checker

`checker({ config })` returns `Promise<boolean>`. The admin check endpoint saves
`lastCheckedAt` and `lastCheckOk` only when a config row already exists. A
thrown checker error produces `{ ok: false, error }` with HTTP 500; returning
`false` produces `{ ok: false }` with HTTP 200.

## Secret behavior

Password values are excluded from provider read responses. Their field metadata
contains `hasValue` instead. The whole stored config is encrypted when
`ENCRYPTION_KEY` is set. Development without a key logs a warning and stores
plaintext; production without a key throws. The key must contain exactly 64 hex
characters (32 bytes). Preserve it across deployments.
