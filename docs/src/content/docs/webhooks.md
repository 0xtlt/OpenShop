---
title: Webhooks
description: Define Shopify webhook handlers.
---

Webhook handlers export `defineWebhook()`.

```ts
import { defineWebhook } from 'openshop'

export const ordersCreate = defineWebhook({
  async run({ topic, shop, payload, apiVersion }) {
    console.log({ topic, shop, apiVersion, payload })
  },
})
```

Register handlers in config:

```ts
export default defineConfig({
  providers: {},
  flows: {},
  webhooks: {
    'orders/create': ordersCreate,
  },
})
```

OpenShop verifies Shopify webhook HMAC signatures before calling handlers.
