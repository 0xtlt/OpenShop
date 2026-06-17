# GraphQL

Use this reference for Shopify Admin GraphQL operations and OpenShop codegen work.

## Expected Pattern

OpenShop app code should use `#graphql` template literals with `shopify.graphql()`:

```ts
const data = await shopify.graphql(`#graphql
  query GetProduct($id: ID!) {
    product(id: $id) {
      id
      title
    }
  }
`, { variables: { id } })
```

The generated bridge file augments `OpenShopQueries` and `OpenShopMutations`, so `shopify.graphql()` infers variables and return types from the literal operation.

When extracting an operation into `queries/*.ts` or another shared module, preserve the string literal with `graphqlOperation()`:

```ts
import { graphqlOperation } from 'openshop/graphql'

export const customerGarageQuery = graphqlOperation(`#graphql
  query CustomerGarage($id: ID!) {
    customer(id: $id) { id displayName }
  }
`)
```

Then pass that constant directly to `shopify.graphql()`.

## Do Not Cast Generated Operations

Do not write this pattern:

```ts
const data = await shopify.graphql(`#graphql
  query GetProduct($id: ID!) {
    product(id: $id) { id title }
  }
`, { variables: { id } }) as GetProductQuery
```

Avoid `graphql(...) as SomeGeneratedType`, `shopify.graphql(...) as SomeGeneratedType`, and `as unknown as SomeGeneratedType` around generated operations. These casts hide broken codegen, stale operation names, wrong variables, missing fields, and nullable return shapes.

If inference is missing:
- Confirm the operation is inside a configured document glob (`flows`, `webhooks`, `proxy`, `server`, `queries`, or `lib/server` by default).
- Confirm the template starts with `#graphql`.
- If the operation is in a shared constant, define it with `graphqlOperation()` from `openshop/graphql`.
- Run `pnpm run codegen` in the app when available.
- Check that `types/generated/` and `types/openshop-operations.d.ts` are produced.
- Fix the codegen bridge or GraphQL document instead of silencing the error with a cast.

## Acceptable Narrowing

Use local narrowing only after the typed GraphQL response is inferred:

```ts
const product = data.product
if (!product) throw new Error('Product not found')
```

Use explicit domain types for transformed outputs, not for forcing raw GraphQL data:

```ts
type WarehouseOrder = {
  id: string
  name: string
  items: number
}

const orders: WarehouseOrder[] = data.orders.edges.map((edge) => ({
  id: edge.node.id,
  name: edge.node.name,
  items: edge.node.lineItems.edges.length,
}))
```

## Framework Code

When changing GraphQL support in `packages/openshop`:
- Keep `packages/openshop/src/graphql/config.ts` aligned with the Shopify API codegen preset.
- Keep bridge generation in `packages/openshop/src/vite/codegen-utils.ts` compatible with generated query and mutation interfaces.
- Preserve scalar patching unless the upstream preset no longer emits `any`.
- Add or update tests under `packages/openshop/tests/unit/vite/codegen-utils.spec.ts` for bridge/codegen utility behavior.
- Update `docs/src/content/docs/graphql-codegen.md` and `packages/openshop/templates/minimal` when user-facing setup changes.
