---
title: Testing
description: Test OpenShop apps with signed proxy requests, session tokens, fakes, and factories.
---

OpenShop provides helpers from `openshop/test`.

```ts
import { createTestContext } from 'openshop/test'

const ctx = await createTestContext({ accessToken: 'test-access-token' })
```

## Flow tests

```ts
ctx.fakes.warehouse.push.returns(undefined)

const result = await ctx.runFlow('syncOrders', { limit: 10 })

assert.equal(result.status, 'completed')
assert.isTrue(ctx.fakes.warehouse.push.called)
```

## Proxy tests

The proxy client signs app proxy HMAC parameters automatically.

```ts
const res = await ctx.proxy
  .get('/reviews')
  .asCustomer('123')
  .qs({ page: '1' })
  .send()
```

## API tests

Use `ctx.authorizationHeader()` to create a signed Shopify session token.

```ts
await fetch(`${ctx.url}/api/runs`, {
  headers: { Authorization: ctx.authorizationHeader() },
})
```

## Factories

Factories create Shopify resources through the test shop client and clean them up in reverse order.
