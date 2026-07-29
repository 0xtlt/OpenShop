---
title: Webhooks
description: Define, register, authenticate, and safely process Shopify webhooks.
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

Register the definition in `openshop.config.ts`:

```ts
import { ordersCreate } from '#webhooks/ordersCreate'

export default app.defineConfig({
  flows: {},
  webhooks: {
    'orders/create': ordersCreate,
  },
})
```

Keys may also use Shopify's normalized header form such as `ORDERS_CREATE`.
OpenShop first checks the exact topic (`orders/create`), then replaces `/` with
`_` and uppercases it.

## HTTP endpoint and context

Shopify sends all configured topics to `POST /webhooks`.

| Field | Shopify source |
| --- | --- |
| `topic` | `X-Shopify-Topic` |
| `shop` | `X-Shopify-Shop-Domain` |
| `shopifyApp` | App selected by matching the body HMAC against its secret |
| `payload` | Parsed JSON request body |
| `apiVersion` | `X-Shopify-Api-Version` |

OpenShop verifies `X-Shopify-Hmac-Sha256` against the raw request body before
parsing JSON. In multi-app mode, exactly one configured app secret must match.

## Register with Shopify

Adding a handler to `openshop.config.ts` does not create a Shopify subscription.
Declare or manage the corresponding subscription in your Shopify app
configuration and point it to `/webhooks`, then deploy that configuration using
Shopify CLI. Topics, API versions, protected-customer-data requirements, and
delivery retry policies are Shopify-owned contracts; verify them against the
Shopify version used by your app.

## Response behavior

| Status | Condition |
| --- | --- |
| `200 { ok: true }` | Handler completed. |
| `200 { ok: true }` | No handler matched; OpenShop logs a warning. |
| `200 { ok: true }` | Handler threw; OpenShop logs the error. |
| `400` | Authenticated body is not valid JSON. |
| `401` | HMAC did not match exactly one configured app. |
| `500` | No Shopify app secret is configured. |

Handler exceptions deliberately return 200, so Shopify will not retry them.
OpenShop does not provide automatic retries for webhook handlers.

## Idempotence and durable work

Shopify can deliver the same event more than once. `defineWebhook()` does not
deduplicate deliveries and the current context does not expose a webhook ID.
Make side effects idempotent using a stable identifier from the payload, or
dispatch a flow whose first step checks a durable app-owned record.

For work that must retry, keep the webhook handler short and dispatch a flow.
Do not rely on throwing from the handler: OpenShop acknowledges the delivery.
