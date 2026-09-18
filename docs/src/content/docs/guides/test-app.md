---
title: Test an app
description: Set up a test database and Node.js test runner, then verify an authenticated API request and a flow with faked services.
---

Use this guide for a generated app with the sample `syncOrders` flow and
`warehouse` provider. It uses Node.js's built-in test runner, a real local HTTP
server, a dedicated PostgreSQL database, and fake external responses.

The minimal template includes `pnpm run test` but no `tests/bootstrap.ts`.
Create that file below before running the command.

## 1. Prepare a test database

For the local container from the first-app tutorial, create a separate database
once:

```bash
docker exec openshop-postgres createdb -U openshop openshop_test
```

If you use another PostgreSQL instance, create a dedicated database there.
Export its URL in the terminal used for tests and apply the committed schema:

```bash
export DATABASE_URL=postgresql://openshop:openshop@localhost:5432/openshop_test
pnpm run db:migrate
```

`openshop test` also attempts to push the development schema. Always provide the
test URL explicitly: the CLI otherwise defaults to the local `openshop` database.

## 2. Add the test runner

Create `tests/bootstrap.ts`:

```ts
import { spawnSync } from 'node:child_process'

const result = spawnSync(process.execPath, [
  '--test',
  '--test-force-exit',
  'tests/app.test.ts',
], { stdio: 'inherit', env: process.env })

if (result.error) throw result.error
process.exitCode = result.status ?? 1
```

The force-exit option ends the test process after the tests finish, including any
idle database pool connections. Tests must still close their HTTP contexts and
restore mocks in teardown.

## 3. Test a flow and an authenticated request

Create `tests/app.test.ts`:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestContext } from 'openshop/test'

test('syncs an order with fake external services', async (t) => {
  const ctx = await createTestContext({
    shop: 'docs-test.myshopify.com',
    accessToken: 'test-access-token',
  })
  t.after(() => ctx.shutdown())

  const originalFetch = globalThis.fetch
  t.mock.method(globalThis, 'fetch', async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url.startsWith('https://docs-test.myshopify.com/admin/api/')) {
      const order = { id: 'gid://shopify/Order/1', name: '#1001' }
      return Response.json({
        data: { orders: { edges: [{ node: order }], nodes: [order] } },
      })
    }
    return originalFetch(input, init)
  })

  ctx.fakes.warehouse.push.returns(true)
  const run = await ctx.runFlow('syncOrders', { limit: 10 })

  assert.equal(run.status, 'completed')
  assert.equal(ctx.fakes.warehouse.push.callCount, 1)
  assert.deepEqual(ctx.fakes.warehouse.push.lastCall?.args[0], [
    { id: 'gid://shopify/Order/1', name: '#1001' },
  ])

  const response = await fetch(`${ctx.url}/api/runs`, {
    headers: { Authorization: ctx.authorizationHeader() },
  })
  assert.equal(response.status, 200)
  assert.ok(Array.isArray(await response.json()))
})
```

The fixture supports both the template's `edges` query and the flow guide's
`nodes` query. Update it when your flow requests different fields.
`runFlow()` executes immediately with fake provider methods; it does not need a
worker. Shopify requests must be mocked separately, as above. Node's test context
restores the fetch mock after the test.

## 4. Run and inspect the result

From the project root:

```bash
DATABASE_URL=postgresql://openshop:openshop@localhost:5432/openshop_test \
pnpm run test
```

The runner should report one passing test. A failed assertion must produce a
nonzero exit code. If schema tables are missing, confirm that migrations were
applied to this same test database.

The context does not truncate tables or isolate data between tests. Use distinct
shops or identifiers and clean up app-owned rows as your suite grows. Keep test
credentials and factories away from production shops.

## Add other coverage

- Use [dispatchFlow](/reference/testing/#test-a-flow) to assert queue insertion;
  the test context does not start a worker.
- Use the [proxy test client](/reference/testing/#test-a-proxy-route) for signed
  storefront requests.
- Use [factories](/reference/testing/#use-factories-and-automatic-cleanup) only
  when a test must create real Shopify resources.
- See [custom admin page testing](/reference/custom-admin-pages/#testing) for
  loader and action helpers.

All helper options and cleanup contracts are in the [testing reference](/reference/testing/).
