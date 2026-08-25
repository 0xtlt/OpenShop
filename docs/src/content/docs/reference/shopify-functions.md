---
title: Shopify Functions
description: Define strict function capabilities and manage Shopify Function owners safely.
---

`app.defineFunction()` is the only public interface for Shopify Function
management. It describes an already-deployed Shopify Function and the Shopify
owner records that OpenShop may create. It does not build, deploy, or execute the
WASM extension.

```ts
import { type } from 'arktype'

export const volumeDiscount = app.defineFunction({
  type: 'discount',
  handle: 'volume-discount',
  label: 'Volume discount',
  modes: ['automatic', 'code'],
  config: {
    threshold: {
      type: 'number',
      label: 'Minimum quantity',
      validate: type('number.integer >= 1'),
    },
  },
  defaults: {
    title: (config) => `Buy ${config.threshold}+ items`,
    combinesWith: { productDiscounts: true },
  },
  ui: {
    configurationPath: '/bundles/:id',
    configurationLabel: 'Configure bundle',
  },
})
```

The `handle` must exactly match the deployed Shopify Function extension handle.
OpenShop requires non-empty, unique handles and filters every Shopify owner by
that handle. The local display `label` falls back to the humanized key in
`functions`, then the humanized handle.

## Strict definitions

The `type` discriminates the accepted `defaults` at TypeScript compile time and
again when OpenShop starts:

| Type | Type-specific defaults | Shopify settings updates | Cardinality |
| --- | --- | --- | --- |
| `discount` | `title`, `startsAt`, `endsAt`, `usageLimit`, `combinesWith` | Yes | Many |
| `cart-transform` | `blockOnFailure` | No | One |
| `delivery-customization` | `title`, `enabled` | Yes | Many |
| `payment-customization` | `title`, `enabled` | Yes | Many |
| `checkout-validation` | `title`, `enabled`, `blockOnFailure` | Yes | Many |
| `fulfillment-constraints` | `deliveryMethodTypes` | Yes | Many |

`modes: ('automatic' | 'code')[]` belongs only to discounts. A Cart Transform
does not have a Shopify title or editable status: its OpenShop label is local,
and an existing owner is always represented as `active`. Shopify does not expose
an owner update mutation for it, so changing `blockOnFailure` requires deleting
and recreating the owner. See Shopify's
[CartTransform object](https://shopify.dev/docs/api/admin-graphql/2026-04/objects/CartTransform).

Fulfillment constraints use Shopify's direct `fulfillmentConstraintRules` list,
the `deliveryMethodTypes` setting, and `fulfillmentConstraintRuleUpdate`. See the
[FulfillmentConstraintRule object](https://shopify.dev/docs/api/admin-graphql/2026-04/objects/FulfillmentConstraintRule)
and [DeliveryMethodType values](https://shopify.dev/docs/api/admin-graphql/2026-04/enums/DeliveryMethodType).

Options from another type are errors. For example, this does not compile and is
also rejected if an untyped config reaches runtime:

```ts
app.defineFunction({
  type: 'cart-transform',
  handle: 'bundle-transform',
  defaults: {
    title: 'Bundles', // unsupported: Cart Transform has no Shopify title
  },
})
```

## Settings and app config

`settings` are native Shopify owner properties such as `enabled`,
`blockOnFailure`, or `deliveryMethodTypes`. `config` contains only fields declared
by the application. Fields use the provider field descriptors `text`, `password`,
`number`, `select`, and `checkbox`; they are required unless `required: false`.
OpenShop validates and stores only those declared values in the owner's JSON
metafield:

```txt
namespace: $app:openshop
key: <function handle>
type: json
```

Updating owner settings and updating this metafield are separate capabilities.
This allows, for example, a Cart Transform to keep read-only Shopify settings
while still exposing editable app config. A missing metafield is returned as
`{ state: 'missing' }`; malformed or non-object JSON is returned as
`{ state: 'invalid', raw }`. Neither is silently converted to `{}`.

## Application-owned configuration UI

`ui.configurationPath` is an app-relative path beginning with `/`. Every `:id`
segment is replaced with the URL-encoded Shopify owner ID. The optional
`configurationLabel` controls the link text.

OpenShop renders the link but does not own the target screen or any domain model
behind it. For example, `/bundles/:id` may open a bundle-builder Module supplied
by the application; OpenShop does not manage `bundle_builder.config`.

## Admin API contract

The existing route paths remain available:

```txt
GET    /api/functions
GET    /api/functions/:handle/instances
POST   /api/functions/:handle/instances
PUT    /api/functions/:handle/instances/:id
DELETE /api/functions/:handle/instances/:id
```

Definitions contain only:

```ts
{
  label, type, handle,
  capabilities,
  settingsFields,
  configFields,
  ui,
}
```

Instances contain only:

```ts
{
  id,
  label,
  state, // active | inactive | scheduled | expired | unknown
  settings,
  config, // missing | valid | invalid
  operations,
}
```

Create and update accept `{ settings?, config? }`; no generic `title`, `status`,
`enabled`, `mode`, or flat config fallback is accepted at the top level. Create
returns `201` with `{ ok: true, id }`; update and delete return `{ ok: true }`.
Discount delete mode is inferred from the live owner.

Errors use one stable envelope:

```json
{
  "error": {
    "code": "instance_limit_reached",
    "message": "Function \"bundle-transform\" already has its maximum number of instances"
  }
}
```

| Status | Codes | Meaning |
| --- | --- | --- |
| `400` | `invalid_request`, `shopify_user_error` | Invalid fields or Shopify mutation user errors. |
| `404` | `function_not_found`, `instance_not_found` | Unknown local definition or owner. |
| `405` | `operation_not_supported` | The owner type does not expose that operation. |
| `409` | `instance_limit_reached` | A singleton Cart Transform already exists. |
| `502` | `shopify_error` | Shopify Admin API transport or GraphQL failure. |

## Extension lifecycle

Deploy the Shopify Function with Shopify's tooling before creating an owner in
OpenShop. Deploying OpenShop config does not publish WASM or register a handle.
Deleting an owner does not remove the deployed extension.

The production Adapter targets Shopify Admin API `2026-04`.
