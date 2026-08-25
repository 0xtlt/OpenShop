---
title: Shopify Functions
description: Define management metadata and understand the supported instance lifecycle.
---

`app.defineFunction()` configures OpenShop's admin UI and the GraphQL mutations
used to manage Shopify Function owners. It does not build, deploy, or execute the
WASM extension.

```ts
export const volumeDiscount = app.defineFunction({
  type: 'discount',
  handle: 'volume-discount',
  label: 'Volume discount',
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

The `handle` must match the Shopify Function extension handle deployed for the
app. OpenShop requires handles to be non-empty and unique in its config.
`label` is optional, stays local to OpenShop, and falls back to the humanized
key used in the `functions` config.

## Supported lifecycle

| Type | List | Create | Update | Delete |
| --- | --- | --- | --- | --- |
| `discount` | `discountNodes` | Automatic or code | Yes | Yes |
| `cart-transform` | `cartTransforms` | Yes | No | Yes |
| `delivery-customization` | `deliveryCustomizations` | Yes | Yes | Yes |
| `payment-customization` | `paymentCustomizations` | Yes | Yes | Yes |
| `checkout-validation` | `validations` | Yes | Yes | Yes |
| `fulfillment-constraints` | `fulfillmentConstraintRules` | Yes | No | Yes |

For types without update, the API returns a 400 instructing the caller to delete
and recreate. These mappings reflect the GraphQL operations currently used by
OpenShop; Shopify availability and required scopes depend on the Admin API
version and app configuration.

Cart Transform is a singleton owner. Shopify does not provide it with a title
or an editable enabled status, so OpenShop displays the definition `label` and
derives `Active` from the owner's existence. Its creation form exposes
`blockOnFailure`; once an owner exists, the Create action is hidden.

## Configuration fields

Function config uses provider-style `text`, `password`, `number`, `select`, and
`checkbox` field definitions. Fields are required unless `required: false`.
Numbers and checkboxes are coerced before ArkType validation.

Only declared fields are retained. Missing required fields and ArkType failures
return HTTP 400. OpenShop stores the validated config as JSON in a metafield:

```txt
namespace: $app:openshop
key: <function handle>
type: json
```

The WASM implementation must read the same metafield if it needs this config.

## Owner options

`owner.title` may be a string or `(config) => string`; absent owners use
`Untitled`. `owner.combinesWith` is copied into discount create/update inputs
and defaults to `{}`.

The public type also accepts `startsAt`, `endsAt`, `usageLimit`,
`appliesOnEachItem`, and `enabled`. The current server mutations do not branch
on those flags. Instead, they consume the corresponding request-body values
described below. Treat the flags as definition metadata, not server-side
validation.

The current create mutations always enable delivery, payment, and validation
owners. Cart transforms accept `blockOnFailure` (default `false`);
fulfillment constraints accept `deliveryMethodTypes` (default `['SHIPPING']`).

Discount mode defaults to the first `modes` value, then `automatic`. Automatic
and code creates default `startsAt` to the current time and `endsAt` to `null`.
Code discounts accept `code` and default `usageLimit` to `null`.

## Instance API behavior

The embedded UI calls:

```txt
GET    /api/functions
GET    /api/functions/:handle/instances
POST   /api/functions/:handle/instances
PUT    /api/functions/:handle/instances/:id
DELETE /api/functions/:handle/instances/:id
```

Lists query Shopify live and return at most 50 nodes. Create returns HTTP 201;
update and delete return `{ ok: true }`.

Shopify mutation `userErrors` become HTTP 400 with both a joined `error` string
and the `userErrors` array. Transport or top-level GraphQL errors are thrown by
the Shopify client. Deleting a discount with multiple configured modes requires
`?mode=automatic` or `?mode=code`.

## Extension lifecycle

Build and deploy the Shopify Function extension with Shopify's tooling before
creating an owner in OpenShop. Deploying OpenShop config alone does not publish
WASM or register a function handle. Likewise, deleting an owner instance does
not remove the deployed extension.
