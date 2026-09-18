---
title: Handle a Shopify webhook
description: Register an OpenShop handler and a Shopify subscription, then verify a signed delivery.
---

Use this guide to receive `orders/create` events in an installed development app
with `read_orders` access. There are two registrations: the handler in OpenShop
and the subscription in Shopify.

## 1. Define the handler

Create `webhooks/ordersCreate.ts`:

```ts
import { app } from '#app'

export const ordersCreate = app.defineWebhook({
  async run({ topic, shop, shopifyApp }) {
    console.info('Received Shopify event', { topic, shop, shopifyApp })
  },
})
```

The example logs identity and topic without logging the order payload. OpenShop
verifies Shopify's signature before invoking it.

## 2. Register it in OpenShop

Import the handler in `openshop.config.ts` and add it to `webhooks`. Preserve your
existing flow registry and other settings:

```ts
import { app } from '#app'
import { syncOrders } from '#flows/syncOrders'
import { ordersCreate } from '#webhooks/ordersCreate'

export default app.defineConfig({
  flows: { syncOrders },
  webhooks: { 'orders/create': ordersCreate },
})
```

## 3. Subscribe in Shopify

In the linked Shopify app TOML, retain its `[webhooks]` API version and add:

```toml
[[webhooks.subscriptions]]
topics = ["orders/create"]
uri = "/webhooks"
```

Use Shopify's [app configuration reference](https://shopify.dev/docs/apps/build/cli-for-apps/app-configuration)
for subscription fields and the API version used by your app. Configure any
required order-data access for the development app.

Use `pnpm run shopify` to test the development configuration. When releasing it,
deploy the matching Shopify app configuration as well as your OpenShop build:

```bash
shopify app deploy --config shopify.app.toml
```

For multiple apps, repeat this for each relevant TOML file.

## 4. Verify delivery and failure handling

Create a test order on the development store. Check the OpenShop **web process**
logs for **Received Shopify event** and the expected shop and app handle. This
handler runs in the HTTP process, so its message is not a flow-run log.

If no message arrives, verify the subscription, destination URL, app installation,
and requested scopes. An unsigned direct `curl` request should return 401.
Run `pnpm run lint` to check the handler before shipping.

:::caution[Handler errors are acknowledged]
OpenShop logs handler exceptions and still returns HTTP 200. Shopify will not
retry a delivery because your handler threw. For retryable work, enqueue a flow
from the handler and monitor dispatch failures as well as flow failures.
:::

Use a stable business identifier to make duplicate deliveries safe. See the
[webhook response contract](/reference/webhooks/#response-behavior) and
[flow dispatch API](/reference/sdk/#configuredopenshopdispatchflowparams) before
adding side effects.
