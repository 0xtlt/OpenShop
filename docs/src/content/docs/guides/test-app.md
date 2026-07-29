---
title: Test an OpenShop app
description: Test flows, proxy routes, and API requests with OpenShop test helpers.
---

OpenShop exposes its test API from `openshop/test`. The context uses your configured
PostgreSQL database and starts a real local HTTP server; it does not create an
isolated database automatically.

## Install a test lifecycle

```ts
import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createTestContext } from 'openshop/test'
import type { TestContext } from 'openshop/test'

describe('OpenShop app', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await createTestContext({
      configPath: new URL('../../openshop.config.ts', import.meta.url).pathname,
      accessToken: 'test-access-token',
    })
  })

  afterEach(async () => {
    await ctx.shutdown()
  })

  it('serves health', async () => {
    const response = await fetch(`${ctx.url}/health`)
    assert.equal(response.status, 200)
  })
})
```

`shutdown()` closes the server and destroys factory-created Shopify resources.
Always call it in teardown, even after a failed assertion.

## `TestOptions`

| Option | Default | Purpose |
| --- | --- | --- |
| `configPath` | `<cwd>/openshop.config.ts` | Absolute or importable path to the config module. |
| `port` | Random `40000`–`49999` | Local HTTP port. Set one only when another tool needs a stable port. |
| `shop` | `test.myshopify.com` | Default shop for flows, proxy signatures, tokens, and factories. |
| `secret` | `SHOPIFY_API_SECRET` or `test-secret` | Signs proxy requests and session tokens. |
| `apiKey` | `SHOPIFY_API_KEY` or `test-app` | Session-token audience. |
| `accessToken` | None | Inserts/updates an installation so Shopify client calls and factories can run. |

The helper sets `SHOPIFY_API_SECRET` and `SHOPIFY_API_KEY` in the current process.
Use separate test processes if suites require different global credentials.

## Test a flow

```ts
import assert from 'node:assert/strict'

ctx.fakes.warehouse.push.returns(true)

const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  if (String(input).includes('/admin/api/')) {
    return new Response(JSON.stringify({
      data: {
        orders: {
          edges: [{ node: { id: 'gid://shopify/Order/1', name: '#1001' } }],
        },
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return realFetch(input, init)
}

let result
try {
  result = await ctx.runFlow(
    'syncOrders',
    { limit: 10 },
    'test.myshopify.com',
  )
} finally {
  globalThis.fetch = realFetch
}

assert.equal(result.status, 'completed')
assert.equal(ctx.fakes.warehouse.push.called, true)
assert.equal(ctx.fakes.warehouse.push.callCount, 1)
assert.equal(Array.isArray(ctx.fakes.warehouse.push.lastCall?.args[0]), true)
```

`runFlow(flowName, input?, shop?)` inserts a running row and executes the flow
immediately with fake provider connectors. It does not require a worker.
Shopify GraphQL calls are not faked automatically. The example temporarily
stubs `globalThis.fetch`; larger suites should use a request-mocking library and
restore it in teardown.

Use `dispatchFlow(flowName, input?, shop?)` to test queueing:

```ts
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { flowRuns } from 'openshop/schema'

const { runId } = await ctx.dispatchFlow('syncOrders', { limit: 10 })

const [run] = await ctx.db
  .select()
  .from(flowRuns)
  .where(eq(flowRuns.id, runId))

assert.equal(run.status, 'pending')
```

`dispatchFlow` only queues the run. `createTestContext` does not start a worker.

## Configure provider fakes

Every configured provider method becomes a typed async fake:

```ts
const push = ctx.fakes.warehouse.push

push.returns({ accepted: true })
push.rejects(new Error('warehouse offline'))
push.onCall(0).returns({ accepted: true })
push.onCall(1).rejects(new Error('rate limited'))
push.impl(async (orderId) => ({ accepted: orderId.length > 0 }))

console.log(push.called)
console.log(push.callCount)
console.log(push.calls)
console.log(push.lastCall)

push.reset()
ctx.resetFakes()
```

Each call record contains `args`, `returnedValue`, `thrownError`, and `timestamp`.
`reset()` clears behavior and history for one method; `ctx.resetFakes()` resets every
provider fake.

The module also exports `createFakeProviders(config.providers)` and
`resetFakeProviders(fakes)` for tests that do not need an HTTP context.

## Test a proxy route

The proxy client signs app proxy HMAC parameters automatically:

```ts
import assert from 'node:assert/strict'
import { type } from 'arktype'

const res = await ctx.proxy
  .get('/reviews')
  .asCustomer('123')
  .qs({ page: '1' })
  .header('X-Test-Request', 'proxy-spec')
  .expect(type({
    reviews: [{ id: 'string', rating: 'number' }],
  }))
  .send()

assert.equal(res.status, 200)
assert.match(res.contentType, /json/)
assert.equal(res.body.reviews[0]?.rating, 5)
```

Available builders are `get`, `post`, `put`, `delete`, and `patch`. Chain:

- `asCustomer(id)` to set `logged_in_customer_id`;
- `qs({ ... })` to add signed query parameters;
- `json(value)` to send JSON and set its content type;
- `header(name, value)` to add a header;
- `expect(arktypeSchema)` to validate and type the decoded response;
- `send()` to receive `{ status, headers, body, text, contentType }`.

## Test the Admin API

Use `ctx.authorizationHeader()` to create a signed Shopify session token:

```ts
import assert from 'node:assert/strict'

const response = await fetch(`${ctx.url}/api/runs`, {
  headers: { Authorization: ctx.authorizationHeader() },
})

assert.equal(response.status, 200)
assert.equal(Array.isArray(await response.json()), true)
```

For custom claims, `ctx.sessionToken(shop?, sub?)` returns the raw JWT and
`ctx.authorizationHeader(shop?, sub?)` returns `Bearer <jwt>`.

## Use factories and automatic cleanup

Factories create real Shopify resources when the context has an installation and
access token:

```ts
import { defineFactory } from 'openshop/test'

interface Customer {
  id: string
  email: string
}

interface CustomerOverrides {
  email: string
}

export const customerFactory = defineFactory<Customer, CustomerOverrides>({
  async create(shopify, overrides) {
    const email = overrides?.email ?? `test-${Date.now()}@example.com`
    const data = await shopify.graphql(`#graphql
      mutation CreateCustomer($input: CustomerInput!) {
        customerCreate(input: $input) {
          customer { id email }
          userErrors { message }
        }
      }
    `, {
      variables: { input: { email } },
    }) as {
      customerCreate: {
        customer: Customer
        userErrors: Array<{ message: string }>
      }
    }

    if (data.customerCreate.userErrors.length) {
      throw new Error(data.customerCreate.userErrors[0]!.message)
    }
    return data.customerCreate.customer
  },
  async destroy(shopify, customer) {
    await shopify.graphql(`#graphql
      mutation DeleteCustomer($id: ID!) {
        customerDelete(input: { id: $id }) {
          deletedCustomerId
          userErrors { message }
        }
      }
    `, {
      variables: { id: customer.id },
    })
  },
})
```

Create and track a resource:

```ts
const customer = await ctx.create(customerFactory, {
  email: 'flow-test@example.com',
})
```

`ctx.cleanup()` destroys tracked resources in last-in, first-out order. Cleanup
continues after a destroy error and logs the failure. `ctx.shutdown()` calls cleanup
again safely before closing the server.

For manual lifecycle control, `openshop/test` also exports `FactoryScope`. Construct
it with a `ShopifyClient`, call `scope.create(factory, overrides)`, inspect
`scope.size`, and call `scope.cleanup()` in teardown.

Without `accessToken`, `ctx.create()` throws because no Shopify client can be
constructed. Prefer a dedicated development shop and never run destructive
factories against a production shop.

## Query the database

`ctx.db` is the shared Drizzle client:

```ts
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { flowRuns } from 'openshop/schema'

const rows = await ctx.db
  .select()
  .from(flowRuns)
  .where(eq(flowRuns.shop, 'test.myshopify.com'))

assert.equal(rows.every((run) => run.shop === 'test.myshopify.com'), true)
```

The context does not truncate tables. Use a separate test database, generate unique
test data, and delete application-owned rows in teardown.

## Run the tests

Set a test database and run the application test command:

```bash
DATABASE_URL=postgresql://openshop:openshop@localhost:5432/openshop_test \
pnpm run test
```

Use `runFlow` for fast flow behavior, `dispatchFlow` for queue contracts, the proxy
client for signed HTTP contracts, and factories only when the test must verify
Shopify itself.
