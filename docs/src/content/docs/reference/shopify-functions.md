---
title: Shopify Functions
description: Manage Shopify Function instances from the embedded admin UI.
---

`app.defineFunction()` configures the OpenShop management UI and GraphQL mutations for Shopify Function instances. It does not define the WASM function implementation.

```ts
export const volumeDiscount = app.defineFunction({
  type: 'discount',
  handle: 'volume-discount',
  modes: ['automatic', 'code'],
  owner: {
    title: (config) => `Volume discount ${config.threshold}`,
    combinesWith: { productDiscounts: true },
    startsAt: true,
    endsAt: true,
  },
  config: {
    threshold: { type: 'number', label: 'Minimum quantity' },
    percentage: { type: 'number', label: 'Percentage off' },
  },
})
```

## Supported function types

- `discount`
- `cart-transform`
- `delivery-customization`
- `payment-customization`
- `checkout-validation`
- `fulfillment-constraints`

Some Shopify Function types do not support update mutations. OpenShop surfaces this in the admin UI and expects delete-and-recreate for those types.
