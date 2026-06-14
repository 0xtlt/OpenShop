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
