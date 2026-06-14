---
title: GraphQL Codegen
description: Generate typed Shopify Admin GraphQL operations.
---

OpenShop integrates with Shopify API codegen. The template includes `.graphqlrc.ts`:

```ts
import { graphqlConfig } from 'openshop/graphql'

export default graphqlConfig()
```

Run codegen:

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
