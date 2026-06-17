---
title: GraphQL Codegen
description: Generate typed Shopify Admin GraphQL operations.
---

OpenShop integrates with Shopify API codegen. The template includes `.graphqlrc.ts`:

```ts
import { graphqlConfig } from 'openshop/graphql'

export default graphqlConfig()
```

`openshop dev` runs codegen once before the first server start, then starts a watcher through Vite. The template also runs codegen before `tsc` in `pnpm run lint`.

Run codegen manually:

```bash
pnpm run codegen
```

Or watch during development:

```bash
pnpm run codegen:watch
```

Use `#graphql` template literals in flows and webhooks:

```ts
const data = await shopify.graphql(`#graphql
  query ProductTitle($id: ID!) {
    product(id: $id) { id title }
  }
`, { variables: { id } })
```

OpenShop generates a bridge file that augments global query and mutation interfaces, allowing `shopify.graphql()` to infer variables and return types.
The generated `types/generated/` directory and `types/openshop-operations.d.ts` bridge are ignored by the template gitignore.

By default, OpenShop scans GraphQL operations in:

```txt
flows/
webhooks/
proxy/
server/
queries/
lib/server/
```

Override `documents` in `graphqlConfig()` only when an app uses a different layout.

## Shared operations

When a query or mutation is reused across files, keep the operation as a string literal with `graphqlOperation()`:

```ts
import { graphqlOperation } from 'openshop/graphql'

export const customerGarageQuery = graphqlOperation(`#graphql
  query CustomerGarage($id: ID!) {
    customer(id: $id) { id displayName }
  }
`)
```

Then pass the shared constant directly to `shopify.graphql()`:

```ts
const data = await shopify.graphql(customerGarageQuery, {
  variables: { id: customerId },
})
```

Do not cast the result with `as CustomerGarageQuery`. If inference is missing, run `pnpm run codegen` and fix the GraphQL document, codegen config, or generated bridge instead of silencing the type error.
