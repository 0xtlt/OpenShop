---
title: GraphQL codegen
description: Generate typed Shopify Admin GraphQL operations and understand runtime errors.
---

OpenShop integrates Shopify's Admin API codegen preset.

```ts
// .graphqlrc.ts
import { graphqlConfig } from 'openshop/graphql'

export default graphqlConfig()
```

## Configuration

```ts
graphqlConfig({
  apiVersion: '2026-04',
  documents: ['./flows/**/*.ts', './queries/**/*.ts'],
  outputDir: './types/generated',
})
```

| Option | Default |
| --- | --- |
| `apiVersion` | `2026-04` |
| `outputDir` | `./types/generated` |
| `documents` | `flows`, `webhooks`, `proxy`, `server`, `queries`, and `lib/server` TS/TSX globs |

The schema URL is Shopify's direct Admin GraphQL proxy for the selected API
version. `@shopify/api-codegen-preset` is resolved from the app's
`node_modules`, so it must be installed by the consumer project.

## Commands

```bash
pnpm run codegen
pnpm run codegen:watch
```

`openshop dev` runs codegen once before the first server start, then uses the
Vite watcher. The generated bridge augments `OpenShopQueries` and
`OpenShopMutations`, allowing literal operation strings to carry their variable
and return types into `shopify.graphql()`.

## Inline operations

```ts
const data = await shopify.graphql(`#graphql
  query ProductTitle($id: ID!) {
    product(id: $id) {
      id
      title
    }
  }
`, { variables: { id } })

console.log(data.product?.title)
```

The promise resolves to the contents of Shopify's `data` field, not the complete
GraphQL response. Do not read `data.data`.

## Shared operations

```ts
import { graphqlOperation } from 'openshop/graphql'

export const customerProfileQuery = graphqlOperation(`#graphql
  query CustomerProfile($id: ID!) {
    customer(id: $id) {
      id
      displayName
    }
  }
`)
```

Pass the constant directly:

```ts
const data = await shopify.graphql(customerProfileQuery, {
  variables: { id: customerId },
})
```

`graphqlOperation()` preserves the string literal type. Do not cast the result.
When inference is missing, run codegen and fix the document, config, or generated
bridge.

## Runtime behavior and errors

`createShopifyClient(shop, shopifyApp?, apiVersion?)` defaults to API version
`2026-04`. For backwards compatibility, a second argument matching `YYYY-MM` is
treated as the API version for the default app.

`shopify.graphql()`:

- throws when no installation access token exists;
- POSTs to the shop's Admin GraphQL endpoint;
- throws on non-2xx HTTP responses and includes the status and response text;
- throws when the top-level GraphQL `errors` array is non-empty;
- returns `json.data` otherwise.

Mutation-specific `userErrors` live inside `data` and are not thrown
automatically. Inspect them in application code.
