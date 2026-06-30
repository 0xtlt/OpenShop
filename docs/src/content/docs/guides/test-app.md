---
title: Test an OpenShop app
description: Test flows, proxy routes, and API requests with OpenShop test helpers.
---

OpenShop exposes app test helpers from `openshop/test`.

## Create a test context

```ts
import { createTestContext } from 'openshop/test'

const ctx = await createTestContext({ accessToken: 'test-access-token' })
```

The context starts an isolated test app surface and provides fakes, clients, and helpers for signed requests.

## Test a flow

```ts
ctx.fakes.warehouse.push.returns(undefined)

const result = await ctx.runFlow('syncOrders', { limit: 10 })

assert.equal(result.status, 'completed')
assert.isTrue(ctx.fakes.warehouse.push.called)
```

## Test a proxy route

The proxy client signs app proxy HMAC parameters automatically:

```ts
const res = await ctx.proxy
  .get('/reviews')
  .asCustomer('123')
  .qs({ page: '1' })
  .send()
```

## Test an API request

Use `ctx.authorizationHeader()` to create a signed Shopify session token:

```ts
await fetch(`${ctx.url}/api/runs`, {
  headers: { Authorization: ctx.authorizationHeader() },
})
```

## Verify it worked

Run the template test script:

```bash
pnpm run test
```

Keep tests close to behavior: unit-test pure helpers, and use OpenShop test context for runtime contracts such as signed proxy requests, flow execution, and API authorization.
