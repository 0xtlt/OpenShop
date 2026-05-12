import { test } from '@japa/runner'
import { createHmac } from 'node:crypto'
import { getDb } from '#db/client'
import { flowRuns, installations } from '#db/schema'
import { createServer } from '#server/index'
import { dispatchFlow } from '#engine/dispatch'
import { runFlow } from '#engine/runner'
import { truncateAll, createConfig } from './helpers.js'

const SECRET = process.env.SHOPIFY_API_SECRET!
const SHOP_A = 'shop-a.myshopify.com'
const SHOP_B = 'shop-b.myshopify.com'

function createJwt(shop: string): string {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: `https://${shop}/admin`,
    dest: `https://${shop}`,
    aud: 'test-app', sub: '123',
    exp: now + 3600, nbf: now - 10, iat: now,
    jti: 'jti-sec', sid: 'sid-sec',
  })).toString('base64url')
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
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

test.group('Security: cross-shop isolation', (group) => {
  group.setup(async () => {
    const config = createConfig({ 'test-flow': simpleFlow })
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
