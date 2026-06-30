---
title: GraphQL codegen
description: Generate typed Shopify Admin GraphQL operations.
---

OpenShop integrates with Shopify API codegen. The template includes `.graphqlrc.ts`:

```ts
import { graphqlConfig } from 'openshop/graphql'

export default graphqlConfig()
```

## Commands

```bash
pnpm run codegen
pnpm run codegen:watch
```

`openshop dev` runs codegen once before the first server start, then starts a watcher through Vite. The template also runs codegen before TypeScript and ESLint checks in `pnpm run lint`.

## Operation literals

Use `#graphql` template literals in flows, webhooks, proxy routes, and server modules:

```ts
const data = await shopify.graphql(`#graphql
  query ProductTitle($id: ID!) {
    product(id: $id) {
      id
      title
    }
  }
`, { variables: { id } })
```

## Shared operations

When a query or mutation is reused across files, keep the operation as a string literal with `graphqlOperation()`:

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

Then pass the shared constant directly to `shopify.graphql()`:

```ts
const data = await shopify.graphql(customerProfileQuery, {
  variables: { id: customerId },
})
```

Do not cast the result with `as CustomerProfileQuery`. If inference is missing, run `pnpm run codegen` and fix the GraphQL document, codegen config, or generated bridge.
