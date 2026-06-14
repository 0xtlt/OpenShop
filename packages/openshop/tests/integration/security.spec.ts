import { test } from '@japa/runner'
import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getDb } from '#db/client'
import { flowRuns, installations, providerConfigs } from '#db/schema'
import { createServer } from '#server/index'
import { dispatchFlow } from '#engine/dispatch'
import { runFlow } from '#engine/runner'
import { truncateAll, createConfig } from './helpers.ts'

const SECRET = process.env.SHOPIFY_API_SECRET!
const SHOP_A = 'shop-a.myshopify.com'
const SHOP_B = 'shop-b.myshopify.com'
const MULTI_APP_SHOP = 'same-shop.myshopify.com'
const MULTI_SHOPIFY = {
  scopes: 'read_products',
  apps: {
    clientA: {
      apiKey: 'client-a-key',
      apiSecret: 'client-a-secret',
      appUrl: 'https://client-a.example.test',
    },
    clientB: {
      apiKey: 'client-b-key',
      apiSecret: 'client-b-secret',
      appUrl: 'https://client-b.example.test',
    },
  },
}

function createJwt(shop: string, options: { aud?: string; secret?: string; jti?: string; sid?: string } = {}): string {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: `https://${shop}/admin`,
    dest: `https://${shop}`,
    aud: options.aud ?? 'test-app', sub: '123',
    exp: now + 3600, nbf: now - 10, iat: now,
    jti: options.jti ?? 'jti-sec', sid: options.sid ?? 'sid-sec',
  })).toString('base64url')
  const sig = createHmac('sha256', options.secret ?? SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

const simpleFlow = {
  name: 'test-flow',
  concurrency: 'allow' as const,
  async run({ logger }: any) { logger.info({}, 'executed') },
}

let app: Awaited<ReturnType<typeof createServer>>

const reqAs = (shop: string, path: string, opts: RequestInit = {}) => {
  const headers = new Headers(opts.headers)
  headers.set('Authorization', `Bearer ${createJwt(shop)}`)
  if (opts.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  return app.request(path, { ...opts, headers })
}

const reqAsApp = (shop: string, shopifyApp: 'clientA' | 'clientB', path: string, opts: RequestInit = {}) => {
  const headers = new Headers(opts.headers)
  const appConfig = MULTI_SHOPIFY.apps[shopifyApp]
  headers.set('Authorization', `Bearer ${createJwt(shop, { aud: appConfig.apiKey, secret: appConfig.apiSecret, jti: `jti-${shopifyApp}`, sid: `sid-${shopifyApp}` })}`)
  if (opts.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  return app.request(path, { ...opts, headers })
}

test.group('Security: cross-shop isolation', (group) => {
  group.setup(async () => {
    const config = createConfig({ 'test-flow': simpleFlow })
    config.providers = {
      warehouse: {
        name: 'warehouse',
        ui: {
          fields: {
            endpoint: { type: 'text', label: 'Endpoint' },
            apiKey: { type: 'password', label: 'API key' },
          },
        },
        async checker({ config }) {
          return config.endpoint === 'https://shop-a.test' && config.apiKey === 'secret-a'
        },
        methods: {},
      },
    }
    app = await createServer(() => config)
  })
  group.each.setup(() => truncateAll())

  test('shop A cannot see shop B runs in /api/runs', async ({ assert }) => {
    const config = createConfig({ 'test-flow': simpleFlow })
    await dispatchFlow({ flowName: 'test-flow', config, shop: SHOP_A })
    await dispatchFlow({ flowName: 'test-flow', config, shop: SHOP_B })

    const resA = await reqAs(SHOP_A, '/api/runs')
    const dataA = await resA.json()
    assert.isTrue(dataA.every((r: any) => r.shop === SHOP_A))

    const resB = await reqAs(SHOP_B, '/api/runs')
    const dataB = await resB.json()
    assert.isTrue(dataB.every((r: any) => r.shop === SHOP_B))
  })

  test('shop A cannot see shop B runs in /api/flows/:name/runs', async ({ assert }) => {
    const config = createConfig({ 'test-flow': simpleFlow })
    await dispatchFlow({ flowName: 'test-flow', config, shop: SHOP_A })
    await dispatchFlow({ flowName: 'test-flow', config, shop: SHOP_B })

    const resA = await reqAs(SHOP_A, '/api/flows/test-flow/runs')
    const dataA = await resA.json()
    assert.isTrue(dataA.every((r: any) => r.shop === SHOP_A))
  })

  test('shop A cannot access shop B run detail (IDOR)', async ({ assert }) => {
    const config = createConfig({ 'test-flow': simpleFlow })
    const { runId: runB } = await dispatchFlow({ flowName: 'test-flow', config, shop: SHOP_B })

    // Shop A tries to access shop B's run
    const res = await reqAs(SHOP_A, `/api/runs/${runB}`)
    assert.equal(res.status, 404)
  })

  test('shop A cannot access shop B logs (IDOR)', async ({ assert }) => {
    const config = createConfig({ 'test-flow': simpleFlow })
    const { runId: runB } = await dispatchFlow({ flowName: 'test-flow', config, shop: SHOP_B })
    await runFlow({ runId: runB, flowName: 'test-flow', config, shop: SHOP_B })
    await new Promise((r) => setTimeout(r, 100))

    const res = await reqAs(SHOP_A, `/api/runs/${runB}/logs?levels=info,warn,error`)
    assert.equal(res.status, 404)
  })

  test('shop A cannot export shop B logs (IDOR)', async ({ assert }) => {
    const config = createConfig({ 'test-flow': simpleFlow })
    const { runId: runB } = await dispatchFlow({ flowName: 'test-flow', config, shop: SHOP_B })

    const res = await reqAs(SHOP_A, `/api/runs/${runB}/logs/export?format=json&levels=info`)
    assert.equal(res.status, 404)
  })

  test('shop A cannot cancel shop B run (IDOR)', async ({ assert }) => {
    const config = createConfig({ 'test-flow': simpleFlow })
    const { runId: runB } = await dispatchFlow({ flowName: 'test-flow', config, shop: SHOP_B })

    const res = await reqAs(SHOP_A, `/api/runs/${runB}/cancel`, { method: 'POST' })
    assert.equal(res.status, 404)
  })

  test('shop A cannot retry shop B run (IDOR)', async ({ assert }) => {
    const config = createConfig({ 'test-flow': simpleFlow })
    const { runId: runB } = await dispatchFlow({ flowName: 'test-flow', config, shop: SHOP_B })

    const res = await reqAs(SHOP_A, `/api/runs/${runB}/retry`, { method: 'POST' })
    assert.equal(res.status, 404)
  })

  test('shop A cannot delete shop B run (IDOR)', async ({ assert }) => {
    const config = createConfig({ 'test-flow': simpleFlow })
    const { runId: runB } = await dispatchFlow({ flowName: 'test-flow', config, shop: SHOP_B })
    await runFlow({ runId: runB, flowName: 'test-flow', config, shop: SHOP_B })

    const res = await reqAs(SHOP_A, `/api/runs/${runB}`, { method: 'DELETE' })
    assert.equal(res.status, 404)

    const [run] = await getDb().select().from(flowRuns).where(eq(flowRuns.id, runB)).limit(1)
    assert.equal(run.id, runB)
    assert.equal(run.shop, SHOP_B)
  })

  test('shop A bulk delete skips shop B run IDs (IDOR)', async ({ assert }) => {
    const config = createConfig({ 'test-flow': simpleFlow })
    const { runId: runA } = await dispatchFlow({ flowName: 'test-flow', config, shop: SHOP_A })
    const { runId: runB } = await dispatchFlow({ flowName: 'test-flow', config, shop: SHOP_B })
    await runFlow({ runId: runA, flowName: 'test-flow', config, shop: SHOP_A })
    await runFlow({ runId: runB, flowName: 'test-flow', config, shop: SHOP_B })

    const res = await reqAs(SHOP_A, '/api/runs/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ ids: [runA, runB] }),
    })
    const body = await res.json()

    assert.equal(res.status, 200)
    assert.deepEqual(body, { deleted: 1, skipped: 1 })

    const remaining = await getDb().select().from(flowRuns).where(eq(flowRuns.id, runB)).limit(1)
    assert.lengthOf(remaining, 1)
    assert.equal(remaining[0].shop, SHOP_B)
  })

  test('shop A cron overrides do not affect shop B', async ({ assert }) => {
    // Shop A disables a cron
    await reqAs(SHOP_A, '/api/crons/toggle', {
      method: 'POST',
      body: JSON.stringify({ key: 'test-flow:*/5 * * * *', enabled: false }),
    })

    // Shop B should still see it as enabled
    const resB = await reqAs(SHOP_B, '/api/crons')
    const dataB = await resB.json()
    const cron = dataB.find((c: any) => c.key === 'test-flow:*/5 * * * *')
    if (cron) assert.isTrue(cron.enabled)
  })

  test('shop A cannot list all active installations or tokens', async ({ assert }) => {
    const db = getDb()
    await db.insert(installations).values([
      { shop: SHOP_A, accessToken: 'token-a', scopes: 'read_products' },
      { shop: SHOP_B, accessToken: 'token-b', scopes: 'read_orders' },
    ])

    const res = await reqAs(SHOP_A, '/api/installations/active')
    assert.equal(res.status, 404)
  })

  test('provider configs are isolated by shop and do not leak secrets', async ({ assert }) => {
    const createA = await reqAs(SHOP_A, '/api/providers/warehouse', {
      method: 'PUT',
      body: JSON.stringify({ config: { endpoint: 'https://shop-a.test', apiKey: 'secret-a' } }),
    })
    const createB = await reqAs(SHOP_B, '/api/providers/warehouse', {
      method: 'PUT',
      body: JSON.stringify({ config: { endpoint: 'https://shop-b.test', apiKey: 'secret-b' } }),
    })
    assert.equal(createA.status, 200)
    assert.equal(createB.status, 200)

    const listA = await reqAs(SHOP_A, '/api/providers')
    const [providerA] = await listA.json()
    assert.equal(providerA.config.endpoint, 'https://shop-a.test')
    assert.notProperty(providerA.config, 'apiKey')
    assert.isTrue(providerA.fields.apiKey.hasValue)

    const listB = await reqAs(SHOP_B, '/api/providers')
    const [providerB] = await listB.json()
    assert.equal(providerB.config.endpoint, 'https://shop-b.test')
    assert.notProperty(providerB.config, 'apiKey')
    assert.isTrue(providerB.fields.apiKey.hasValue)
  })

  test('provider check uses only the current shop config', async ({ assert }) => {
    await reqAs(SHOP_A, '/api/providers/warehouse', {
      method: 'PUT',
      body: JSON.stringify({ config: { endpoint: 'https://shop-a.test', apiKey: 'secret-a' } }),
    })
    await reqAs(SHOP_B, '/api/providers/warehouse', {
      method: 'PUT',
      body: JSON.stringify({ config: { endpoint: 'https://shop-b.test', apiKey: 'secret-b' } }),
    })

    const checkA = await reqAs(SHOP_A, '/api/providers/warehouse/check', { method: 'POST' })
    const checkB = await reqAs(SHOP_B, '/api/providers/warehouse/check', { method: 'POST' })
    const bodyA = await checkA.json()
    const bodyB = await checkB.json()

    assert.equal(checkA.status, 200)
    assert.equal(checkB.status, 200)
    assert.isTrue(bodyA.ok)
    assert.isFalse(bodyB.ok)

    const rows = await getDb().select().from(providerConfigs)
    assert.sameMembers(rows.map((row) => row.shop), [SHOP_A, SHOP_B])
  })
})

test.group('Security: cross-app isolation', (group) => {
  let multiConfig: ReturnType<typeof createConfig>

  group.setup(async () => {
    multiConfig = createConfig({ 'test-flow': simpleFlow }, { shopify: MULTI_SHOPIFY })
    multiConfig.providers = {
      warehouse: {
        name: 'warehouse',
        ui: {
          fields: {
            endpoint: { type: 'text', label: 'Endpoint' },
            apiKey: { type: 'password', label: 'API key' },
          },
        },
        methods: {},
      },
    }
    app = await createServer(() => multiConfig)
  })
  group.each.setup(() => truncateAll())

  test('same shop runs are isolated by Shopify app', async ({ assert }) => {
    const { runId: runA } = await dispatchFlow({ flowName: 'test-flow', config: multiConfig, shopifyApp: 'clientA', shop: MULTI_APP_SHOP })
    const { runId: runB } = await dispatchFlow({ flowName: 'test-flow', config: multiConfig, shopifyApp: 'clientB', shop: MULTI_APP_SHOP })

    const listA = await reqAsApp(MULTI_APP_SHOP, 'clientA', '/api/runs')
    const dataA = await listA.json()
    assert.equal(listA.status, 200)
    assert.deepEqual(dataA.map((run: any) => run.id), [runA])
    assert.deepEqual(dataA.map((run: any) => run.appHandle), ['clientA'])

    const detailBFromA = await reqAsApp(MULTI_APP_SHOP, 'clientA', `/api/runs/${runB}`)
    assert.equal(detailBFromA.status, 404)

    const listB = await reqAsApp(MULTI_APP_SHOP, 'clientB', '/api/runs')
    const dataB = await listB.json()
    assert.deepEqual(dataB.map((run: any) => run.id), [runB])
    assert.deepEqual(dataB.map((run: any) => run.appHandle), ['clientB'])
  })

  test('same shop provider configs are isolated by Shopify app', async ({ assert }) => {
    const createA = await reqAsApp(MULTI_APP_SHOP, 'clientA', '/api/providers/warehouse', {
      method: 'PUT',
      body: JSON.stringify({ config: { endpoint: 'https://client-a.test', apiKey: 'secret-a' } }),
    })
    const createB = await reqAsApp(MULTI_APP_SHOP, 'clientB', '/api/providers/warehouse', {
      method: 'PUT',
      body: JSON.stringify({ config: { endpoint: 'https://client-b.test', apiKey: 'secret-b' } }),
    })
    assert.equal(createA.status, 200)
    assert.equal(createB.status, 200)

    const listA = await reqAsApp(MULTI_APP_SHOP, 'clientA', '/api/providers')
    const [providerA] = await listA.json()
    assert.equal(providerA.config.endpoint, 'https://client-a.test')

    const listB = await reqAsApp(MULTI_APP_SHOP, 'clientB', '/api/providers')
    const [providerB] = await listB.json()
    assert.equal(providerB.config.endpoint, 'https://client-b.test')

    const rows = await getDb().select().from(providerConfigs)
    assert.sameMembers(rows.map((row) => row.appHandle), ['clientA', 'clientB'])
    assert.isTrue(rows.every((row) => row.shop === MULTI_APP_SHOP))
  })
})

test.group('Security: SQL injection', (group) => {
  group.setup(async () => {
    const config = createConfig({ 'test-flow': simpleFlow })
    app = await createServer(() => config)
  })
  group.each.setup(() => truncateAll())

  test('search param with SQL injection returns empty, not error', async ({ assert }) => {
    const payloads = [
      "'; DROP TABLE flow_runs; --",
      "1' OR '1'='1",
      "' UNION SELECT * FROM installations --",
      "Robert'); DROP TABLE flow_runs;--",
    ]

    for (const payload of payloads) {
      const res = await reqAs(SHOP_A, `/api/runs?search=${encodeURIComponent(payload)}`)
      // Should return 200 with empty results, NOT 500
      assert.equal(res.status, 200)
      const data = await res.json()
      assert.isArray(data)
    }
  })

  test('status param with injection is safe', async ({ assert }) => {
    const res = await reqAs(SHOP_A, `/api/runs?status=${encodeURIComponent("' OR 1=1 --")}`)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.isArray(data)
    assert.equal(data.length, 0)
  })

  test('from/to date params with injection are safe', async ({ assert }) => {
    const res = await reqAs(SHOP_A, `/api/runs?from=${encodeURIComponent("' OR 1=1 --")}`)
    // Invalid date is ignored — returns 200 with normal results
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.isArray(data)
  })
})

test.group('Security: auth edge cases', (group) => {
  group.setup(async () => {
    const config = createConfig({ 'test-flow': simpleFlow })
    app = await createServer(() => config)
  })

  test('expired JWT is rejected', async ({ assert }) => {
    const now = Math.floor(Date.now() / 1000)
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({
      iss: `https://${SHOP_A}/admin`, dest: `https://${SHOP_A}`,
      aud: 'test', sub: '1', exp: now - 3600, nbf: now - 7200, iat: now - 7200,
      jti: 'j', sid: 's',
    })).toString('base64url')
    const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
    const token = `${header}.${payload}.${sig}`

    const res = await app.request('/api/flows', {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(res.status, 401)
  })

  test('JWT signed with wrong secret is rejected', async ({ assert }) => {
    const now = Math.floor(Date.now() / 1000)
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({
      iss: `https://${SHOP_A}/admin`, dest: `https://${SHOP_A}`,
      aud: 'test', sub: '1', exp: now + 3600, nbf: now, iat: now,
      jti: 'j', sid: 's',
    })).toString('base64url')
    const sig = createHmac('sha256', 'wrong-secret').update(`${header}.${payload}`).digest('base64url')
    const token = `${header}.${payload}.${sig}`

    const res = await app.request('/api/flows', {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(res.status, 401)
  })

  test('tampered JWT payload is rejected', async ({ assert }) => {
    // Create valid token, then modify payload
    const validToken = createJwt(SHOP_A)
    const [header, _, signature] = validToken.split('.')
    // Swap payload to a different shop
    const tamperedPayload = Buffer.from(JSON.stringify({
      iss: `https://${SHOP_B}/admin`, dest: `https://${SHOP_B}`,
      aud: 'test', sub: '1',
      exp: Math.floor(Date.now() / 1000) + 3600,
      nbf: Math.floor(Date.now() / 1000), iat: Math.floor(Date.now() / 1000),
      jti: 'j', sid: 's',
    })).toString('base64url')

    const tampered = `${header}.${tamperedPayload}.${signature}`
    const res = await app.request('/api/flows', {
      headers: { Authorization: `Bearer ${tampered}` },
    })
    assert.equal(res.status, 401)
  })
})
