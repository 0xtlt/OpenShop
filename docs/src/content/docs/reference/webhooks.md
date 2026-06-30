---
title: Webhooks
description: Shopify webhook handler definition and registration.
---

Webhook handlers export `app.defineWebhook()`.

```ts
import { app } from '#app'

export const ordersCreate = app.defineWebhook({
  async run({ topic, shop, shopifyApp, payload, apiVersion }) {
    console.log({ topic, shop, shopifyApp, apiVersion, payload })
  },
})
```

Register handlers in config:

```ts
import { app } from '#app'
import { ordersCreate } from '#webhooks/ordersCreate'

export default app.defineConfig({
  flows: {},
  webhooks: {
    'orders/create': ordersCreate,
  },
})
```

## Context

| Field | Purpose |
| --- | --- |
| `topic` | Shopify webhook topic. |
| `shop` | Shop domain. |
| `shopifyApp` | Internal app handle. |
| `payload` | Parsed webhook payload. |
| `apiVersion` | Shopify API version used by the webhook. |

OpenShop verifies Shopify webhook HMAC signatures before calling handlers.
