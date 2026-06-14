---
title: Webhooks
description: Define Shopify webhook handlers.
---

Webhook handlers export `app.defineWebhook()`.

```ts
import { app } from '../openshop.app'

export const ordersCreate = app.defineWebhook({
  async run({ topic, shop, payload, apiVersion }) {
    console.log({ topic, shop, apiVersion, payload })
  },
})
```

Register handlers in config:

```ts
import { app } from './openshop.app'
import { ordersCreate } from './webhooks/ordersCreate'

export default app.defineConfig({
  flows: {},
  webhooks: {
    'orders/create': ordersCreate,
  },
})
```

OpenShop verifies Shopify webhook HMAC signatures before calling handlers.
